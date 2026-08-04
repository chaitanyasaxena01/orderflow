import { OUTBOX_EVENT_TYPES, paymentWebhookPayloadSchema } from '@orderflow/shared';
import { prisma } from '../../lib/prisma.js';
import { getEnv } from '../../config/env.js';
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import {
  isTimestampFresh,
  verifyPaymentWebhookSignature,
} from '../../lib/crypto.js';
import {
  convertReservationToSold,
  releaseReservation,
} from '../inventory/inventory.service.js';
import type { Prisma } from '@prisma/client';

export async function handlePaymentWebhook(params: {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  eventId: string | undefined;
}) {
  const env = getEnv();
  const { rawBody, signature, timestamp, eventId } = params;

  if (!signature || !timestamp || !eventId) {
    throw new ValidationError(
      'Missing required headers: x-payment-signature, x-payment-timestamp, x-payment-event-id',
    );
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw new AppError('INVALID_TIMESTAMP', 'Invalid x-payment-timestamp', 400);
  }

  if (!isTimestampFresh(ts, env.WEBHOOK_TIMESTAMP_TOLERANCE_SEC)) {
    throw new AppError('STALE_WEBHOOK', 'Webhook timestamp is outside allowed tolerance', 401);
  }

  if (!verifyPaymentWebhookSignature(env.PAYMENT_WEBHOOK_SECRET, timestamp, rawBody, signature)) {
    throw new AppError('INVALID_SIGNATURE', 'Invalid payment webhook signature', 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const payloadResult = paymentWebhookPayloadSchema.safeParse(parsed);
  if (!payloadResult.success) {
    throw new ValidationError('Invalid webhook payload', payloadResult.error.flatten());
  }
  const payload = payloadResult.data;

  // Idempotent insert of event id
  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        providerEventId: eventId,
        eventType: payload.event,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Unique constraint — already processed
    return {
      duplicate: true,
      message: 'Event already processed',
    };
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: payload.paymentId },
      include: {
        order: {
          include: { items: true, user: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment not found');
    }
    if (payment.orderId !== payload.orderId) {
      throw new AppError('PAYLOAD_MISMATCH', 'paymentId and orderId do not match', 400);
    }

    if (payload.event === 'payment.succeeded') {
      if (payment.status === 'SUCCEEDED') {
        return { duplicate: true, message: 'Payment already succeeded' };
      }
      if (payment.status !== 'PENDING' && payment.status !== 'FAILED') {
        throw new AppError(
          'INVALID_PAYMENT_STATE',
          `Cannot mark payment as succeeded from status ${payment.status}`,
          409,
        );
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          succeededAt: new Date(),
          failureReason: null,
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'PAID', paidAt: new Date() },
      });

      for (const item of payment.order.items) {
        await convertReservationToSold(tx, item.productId, item.quantity);
        const inv = await tx.inventory.findUnique({ where: { productId: item.productId } });
        if (inv) {
          await tx.inventoryAdjustment.create({
            data: {
              productId: item.productId,
              inventoryId: inv.id,
              type: 'SELL',
              quantityDelta: -item.quantity,
              reason: 'payment succeeded',
              metadata: { orderId: payment.orderId, paymentId: payment.id },
            },
          });
        }
      }

      await tx.outboxEvent.create({
        data: {
          eventType: OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED,
          dedupeKey: `payment.succeeded:${payment.id}`,
          payload: {
            orderId: payment.orderId,
            paymentId: payment.id,
            userId: payment.order.userId,
            email: payment.order.user.email,
            firstName: payment.order.user.firstName,
            totalCents: payment.amountCents,
          },
          status: 'PENDING',
        },
      }).catch(() => undefined);

      return { duplicate: false, status: 'SUCCEEDED' };
    }

    if (payload.event === 'payment.failed') {
      if (payment.status === 'FAILED') {
        return { duplicate: true, message: 'Payment already failed' };
      }
      if (payment.status !== 'PENDING') {
        throw new AppError(
          'INVALID_PAYMENT_STATE',
          `Cannot mark payment as failed from status ${payment.status}`,
          409,
        );
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: payload.reason ?? 'payment failed',
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'PAYMENT_FAILED' },
      });

      for (const item of payment.order.items) {
        await releaseReservation(tx, item.productId, item.quantity);
        const inv = await tx.inventory.findUnique({ where: { productId: item.productId } });
        if (inv) {
          await tx.inventoryAdjustment.create({
            data: {
              productId: item.productId,
              inventoryId: inv.id,
              type: 'RELEASE',
              quantityDelta: item.quantity,
              reason: 'payment failed',
              metadata: { orderId: payment.orderId, paymentId: payment.id },
            },
          });
        }
      }

      await tx.outboxEvent.create({
        data: {
          eventType: OUTBOX_EVENT_TYPES.PAYMENT_FAILED,
          dedupeKey: `payment.failed:${payment.id}`,
          payload: {
            orderId: payment.orderId,
            paymentId: payment.id,
            userId: payment.order.userId,
            email: payment.order.user.email,
            firstName: payment.order.user.firstName,
            totalCents: payment.amountCents,
            reason: payload.reason ?? 'payment failed',
          },
          status: 'PENDING',
        },
      }).catch(() => undefined);

      return { duplicate: false, status: 'FAILED' };
    }

    // payment.refunded
    if (payment.status === 'REFUNDED') {
      return { duplicate: true, message: 'Payment already refunded' };
    }
    if (payment.status !== 'SUCCEEDED') {
      throw new AppError(
        'INVALID_PAYMENT_STATE',
        `Cannot refund payment in status ${payment.status}`,
        409,
      );
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: 'REFUNDED' },
    });

    for (const item of payment.order.items) {
      await tx.$executeRaw`
        UPDATE inventory
        SET available_quantity = available_quantity + ${item.quantity},
            sold_quantity = GREATEST(0, sold_quantity - ${item.quantity}),
            version = version + 1,
            updated_at = NOW()
        WHERE product_id = ${item.productId}::uuid
      `;
      const inv = await tx.inventory.findUnique({ where: { productId: item.productId } });
      if (inv) {
        await tx.inventoryAdjustment.create({
          data: {
            productId: item.productId,
            inventoryId: inv.id,
            type: 'RETURN',
            quantityDelta: item.quantity,
            reason: 'payment refunded',
            metadata: { orderId: payment.orderId, paymentId: payment.id },
          },
        });
      }
    }

    return { duplicate: false, status: 'REFUNDED' };
  });
}
