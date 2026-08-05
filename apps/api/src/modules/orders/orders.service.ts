import {
  canTransitionOrder,
  IDEMPOTENCY_SCOPES,
  lineTotalCents,
  OUTBOX_EVENT_TYPES,
  sumCents,
} from '@orderflow/shared';
import { prisma } from '../../lib/prisma.js';
import {
  AppError,
  ForbiddenError,
  InsufficientInventoryError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { generateIdempotencyRequestHash } from '../../lib/crypto.js';
import { releaseReservation, reserveInventory } from '../inventory/inventory.service.js';
import { buildPaginationMeta } from '../../lib/response.js';
import { incMetric } from '../../lib/metrics.js';
import { logger } from '../../lib/logger.js';
import type { OrderStatus, Prisma } from '@prisma/client';

function serializeOrder(
  order: {
    id: string;
    userId: string;
    status: string;
    subtotalCents: number;
    totalCents: number;
    currency: string;
    createdAt: Date;
    updatedAt: Date;
    paidAt: Date | null;
    cancelledAt: Date | null;
    items?: Array<{
      id: string;
      productId: string;
      productName: string;
      productSku: string;
      unitPriceCents: number;
      quantity: number;
      lineTotalCents: number;
    }>;
    payment?: {
      id: string;
      status: string;
      amountCents: number;
      currency: string;
      provider: string;
    } | null;
  },
) {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    subtotalCents: order.subtotalCents,
    totalCents: order.totalCents,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    items: order.items?.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productSku: i.productSku,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      lineTotalCents: i.lineTotalCents,
    })),
    payment: order.payment
      ? {
          id: order.payment.id,
          status: order.payment.status,
          amountCents: order.payment.amountCents,
          currency: order.payment.currency,
          provider: order.payment.provider,
        }
      : undefined,
  };
}

function isRetryableCheckoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const message = String((err as { message?: string }).message ?? '');
  const metaMsg = String((err as { meta?: { message?: string } }).meta?.message ?? '');
  return (
    code === 'P2034' ||
    (code === 'P2010' && (message.includes('40001') || metaMsg.includes('concurrent')))
  );
}

export async function checkout(
  userId: string,
  idempotencyKey: string | undefined,
  requestBody: unknown,
) {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new ValidationError('Idempotency-Key header is required');
  }

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await checkoutOnce(userId, idempotencyKey, requestBody);
      if (!result.fromCache) {
        incMetric('checkout.success');
      }
      return result;
    } catch (err) {
      lastError = err;
      if (isRetryableCheckoutError(err) && attempt < maxAttempts) {
        logger.warn(
          { userId, attempt, err },
          'Retryable checkout conflict; retrying',
        );
        await new Promise((r) => setTimeout(r, 25 * attempt));
        continue;
      }
      if (isRetryableCheckoutError(err)) {
        incMetric('checkout.conflict');
        throw new AppError(
          'CHECKOUT_CONFLICT',
          'Checkout conflict due to concurrent update; retry with the same Idempotency-Key',
          409,
        );
      }
      throw err;
    }
  }

  throw lastError;
}

async function checkoutOnce(
  userId: string,
  idempotencyKey: string,
  requestBody: unknown,
) {
  const scope = IDEMPOTENCY_SCOPES.CHECKOUT;
  const requestHash = generateIdempotencyRequestHash(requestBody ?? {});
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Check existing idempotency record
  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      userId_scope_key: { userId, scope, key: idempotencyKey },
    },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key was already used with a different request body',
        409,
      );
    }
    // Incomplete placeholder from a crashed attempt
    if (existing.responseStatus === 0) {
      throw new AppError(
        'IDEMPOTENCY_IN_PROGRESS',
        'A checkout with this Idempotency-Key is already in progress; retry shortly',
        409,
      );
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBody as Record<string, unknown>,
      fromCache: true,
    };
  }

  // Perform checkout in a transaction.
  // ReadCommitted + FOR UPDATE + conditional inventory update prevents overselling.
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Insert idempotency placeholder early to win races
        try {
          await tx.idempotencyKey.create({
            data: {
              userId,
              scope,
              key: idempotencyKey,
              requestHash,
              responseStatus: 0,
              responseBody: {},
              expiresAt,
            },
          });
        } catch {
          // Unique violation — concurrent duplicate
          const raced = await tx.idempotencyKey.findUnique({
            where: {
              userId_scope_key: { userId, scope, key: idempotencyKey },
            },
          });
          if (raced && raced.requestHash === requestHash && raced.responseStatus > 0) {
            return {
              status: raced.responseStatus,
              body: raced.responseBody as Record<string, unknown>,
              fromCache: true,
            };
          }
          if (raced && raced.requestHash !== requestHash) {
            throw new AppError(
              'IDEMPOTENCY_KEY_REUSED',
              'Idempotency-Key was already used with a different request body',
              409,
            );
          }
          // Still processing or empty — wait isn't practical; treat as conflict for safety
          throw new AppError(
            'IDEMPOTENCY_IN_PROGRESS',
            'A checkout with this Idempotency-Key is already in progress',
            409,
          );
        }

        const cart = await tx.cart.findFirst({
          where: { userId, status: 'ACTIVE' },
          include: {
            items: {
              include: {
                product: { include: { inventory: true } },
              },
            },
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new AppError('EMPTY_CART', 'Cart is empty', 400);
        }

        // Lock inventory rows (row-level) to serialize concurrent checkouts
        for (const item of cart.items) {
          await tx.$queryRaw`
            SELECT id FROM inventory
            WHERE product_id = ${item.productId}::uuid
            FOR UPDATE
          `;
        }

        const lineItems: Array<{
          productId: string;
          productName: string;
          productSku: string;
          unitPriceCents: number;
          quantity: number;
          lineTotalCents: number;
        }> = [];

        for (const item of cart.items) {
          const product = item.product;
          if (!product.isActive || product.archivedAt) {
            throw new AppError(
              'PRODUCT_UNAVAILABLE',
              `Product ${product.name} is no longer available`,
              409,
            );
          }

          const reserved = await reserveInventory(tx, product.id, item.quantity);
          if (!reserved) {
            throw new InsufficientInventoryError(
              `Insufficient inventory for ${product.name}`,
            );
          }

          await tx.inventoryAdjustment.create({
            data: {
              productId: product.id,
              inventoryId: product.inventory!.id,
              type: 'RESERVE',
              quantityDelta: -item.quantity,
              reason: 'checkout reservation',
              metadata: { cartId: cart.id },
            },
          });

          const unitPriceCents = product.priceCents;
          const lt = lineTotalCents(unitPriceCents, item.quantity);
          lineItems.push({
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            unitPriceCents,
            quantity: item.quantity,
            lineTotalCents: lt,
          });
        }

        const subtotalCents = sumCents(lineItems.map((i) => i.lineTotalCents));
        const totalCents = subtotalCents;

        const order = await tx.order.create({
          data: {
            userId,
            status: 'PENDING_PAYMENT',
            subtotalCents,
            totalCents,
            currency: 'USD',
            idempotencyKey,
            items: {
              create: lineItems,
            },
            payment: {
              create: {
                status: 'PENDING',
                amountCents: totalCents,
                currency: 'USD',
                provider: 'simulator',
              },
            },
          },
          include: {
            items: true,
            payment: true,
          },
        });

        await tx.cart.update({
          where: { id: cart.id },
          data: { status: 'CHECKED_OUT' },
        });
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

        await tx.outboxEvent.create({
          data: {
            eventType: OUTBOX_EVENT_TYPES.ORDER_CREATED,
            dedupeKey: `order.created:${order.id}`,
            payload: {
              orderId: order.id,
              userId,
              email: user.email,
              firstName: user.firstName,
              totalCents: order.totalCents,
              currency: order.currency,
            },
            status: 'PENDING',
          },
        });

        const responseBody = {
          success: true,
          data: serializeOrder(order),
        };

        await tx.idempotencyKey.update({
          where: {
            userId_scope_key: { userId, scope, key: idempotencyKey },
          },
          data: {
            responseStatus: 201,
            responseBody: responseBody as Prisma.InputJsonValue,
          },
        });

        return {
          status: 201,
          body: responseBody,
          fromCache: false,
        };
      },
      {
        isolationLevel: 'ReadCommitted',
        timeout: 15_000,
      },
    );

    return result;
  } catch (err) {
    if (isRetryableCheckoutError(err)) {
      throw err; // outer checkout() retries
    }
    throw err;
  }
}

export async function listOrders(
  userId: string,
  role: string,
  page: number,
  limit: number,
) {
  const where: Prisma.OrderWhereInput =
    role === 'ADMIN' || role === 'STAFF' ? {} : { userId };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { items: true, payment: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    orders: orders.map(serializeOrder),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function getOrder(orderId: string, userId: string, role: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payment: true },
  });
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  if (role !== 'ADMIN' && role !== 'STAFF' && order.userId !== userId) {
    throw new ForbiddenError('You cannot access this order');
  }
  return serializeOrder(order);
}

export async function cancelOrder(orderId: string, userId: string, role: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true },
    });
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    if (role !== 'ADMIN' && order.userId !== userId) {
      throw new ForbiddenError('You cannot cancel this order');
    }

    if (!['PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAID', 'PROCESSING'].includes(order.status)) {
      throw new AppError(
        'INVALID_STATUS',
        `Order in status ${order.status} cannot be cancelled`,
        409,
      );
    }

    // Release reserved inventory for unpaid orders; for paid, convert would already have happened
    if (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED') {
      for (const item of order.items) {
        await releaseReservation(tx, item.productId, item.quantity);
        const inv = await tx.inventory.findUnique({ where: { productId: item.productId } });
        if (inv) {
          await tx.inventoryAdjustment.create({
            data: {
              productId: item.productId,
              inventoryId: inv.id,
              type: 'RELEASE',
              quantityDelta: item.quantity,
              reason: 'order cancelled',
              metadata: { orderId: order.id },
            },
          });
        }
      }
    }

    if (order.payment && order.payment.status === 'PENDING') {
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: 'order cancelled' },
      });
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { items: true, payment: true },
    });

    const user = await tx.user.findUniqueOrThrow({ where: { id: order.userId } });
    await tx.outboxEvent.create({
      data: {
        eventType: OUTBOX_EVENT_TYPES.ORDER_CANCELLED,
        dedupeKey: `order.cancelled:${order.id}`,
        payload: {
          orderId: order.id,
          userId: order.userId,
          email: user.email,
          firstName: user.firstName,
          totalCents: order.totalCents,
        },
        status: 'PENDING',
      },
    }).catch(() => {
      // dedupe unique — already cancelled notification
    });

    return serializeOrder(updated);
  });
}

const FULFILLMENT_ACTIONS = {
  process: 'PROCESSING',
  ship: 'SHIPPED',
  complete: 'COMPLETED',
} as const;

export type FulfillmentAction = keyof typeof FULFILLMENT_ACTIONS;

/**
 * Staff/admin order lifecycle transitions after payment.
 * Uses canTransitionOrder for allowed edges.
 */
export async function transitionOrder(
  orderId: string,
  action: FulfillmentAction,
  actorUserId: string,
  actorRole: string,
) {
  if (actorRole !== 'STAFF' && actorRole !== 'ADMIN') {
    throw new ForbiddenError('Only staff or admin can fulfill orders');
  }

  const targetStatus = FULFILLMENT_ACTIONS[action] as OrderStatus;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true },
    });
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    if (!canTransitionOrder(order.status, targetStatus)) {
      throw new AppError(
        'INVALID_STATUS',
        `Cannot transition order from ${order.status} to ${targetStatus}`,
        409,
      );
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: targetStatus },
      include: { items: true, payment: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: `ORDER_${action.toUpperCase()}`,
        entityType: 'Order',
        entityId: orderId,
        metadata: {
          from: order.status,
          to: targetStatus,
        },
      },
    });

    logger.info(
      { orderId, from: order.status, to: targetStatus, actorUserId },
      'Order fulfillment transition',
    );

    return serializeOrder(updated);
  });
}

