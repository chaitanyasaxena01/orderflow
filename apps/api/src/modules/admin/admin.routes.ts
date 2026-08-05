import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, buildPaginationMeta } from '../../lib/response.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { paginationSchema } from '@orderflow/shared';
import { redriveFailedOutbox } from '../notifications/notifications.service.js';
import { getMetrics } from '../../lib/metrics.js';

export const adminRouter = Router();

adminRouter.use(authenticate, authorize('ADMIN'));

adminRouter.get('/users', validate(paginationSchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const [total, users] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    sendSuccess(
      res,
      users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
      200,
      buildPaginationMeta(page, limit, total),
    );
  } catch (err) {
    next(err);
  }
});

const updateUserSchema = z.object({
  role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
});

adminRouter.patch(
  '/users/:id',
  validate(updateUserSchema),
  async (req, res, next) => {
    try {
      if (!req.body.role && !req.body.status) {
        throw new ValidationError('At least one of role or status is required');
      }
      const userId = param(req.params.id);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(req.body.role ? { role: req.body.role } : {}),
          ...(req.body.status ? { status: req.body.status } : {}),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'USER_UPDATE',
          entityType: 'User',
          entityId: updated.id,
          metadata: req.body,
          ipAddress: req.ip,
        },
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get('/stats', async (_req, res, next) => {
  try {
    const [users, products, orders, pendingPayments, outboxPending, outboxFailed] =
      await Promise.all([
        prisma.user.count(),
        prisma.product.count({ where: { archivedAt: null } }),
        prisma.order.count(),
        prisma.payment.count({ where: { status: 'PENDING' } }),
        prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
        prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      ]);
    sendSuccess(res, {
      users,
      products,
      orders,
      pendingPayments,
      outboxPending,
      outboxFailed,
      metrics: getMetrics(),
    });
  } catch (err) {
    next(err);
  }
});

const outboxQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
});

adminRouter.get(
  '/outbox',
  validate(outboxQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, status } = req.query as unknown as {
        page: number;
        limit: number;
        status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
      };
      const where = status ? { status } : {};
      const [total, events] = await Promise.all([
        prisma.outboxEvent.count({ where }),
        prisma.outboxEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      sendSuccess(
        res,
        events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          dedupeKey: e.dedupeKey,
          status: e.status,
          attempts: e.attempts,
          lastError: e.lastError,
          processedAt: e.processedAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
        200,
        buildPaginationMeta(page, limit, total),
      );
    } catch (err) {
      next(err);
    }
  },
);

const redriveSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
});

adminRouter.post(
  '/outbox/redrive',
  validate(redriveSchema),
  async (req, res, next) => {
    try {
      const count = await redriveFailedOutbox(req.body.ids);
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'OUTBOX_REDRIVE',
          entityType: 'OutboxEvent',
          metadata: { ids: req.body.ids ?? null, count },
          ipAddress: req.ip,
        },
      });
      sendSuccess(res, { redriven: count });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/webhooks',
  validate(paginationSchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as { page: number; limit: number };
      const [total, events] = await Promise.all([
        prisma.paymentWebhookEvent.count(),
        prisma.paymentWebhookEvent.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      sendSuccess(
        res,
        events.map((e) => ({
          id: e.id,
          providerEventId: e.providerEventId,
          eventType: e.eventType,
          processedAt: e.processedAt.toISOString(),
          createdAt: e.createdAt.toISOString(),
        })),
        200,
        buildPaginationMeta(page, limit, total),
      );
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/inventory-adjustments',
  validate(paginationSchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as { page: number; limit: number };
      const productId =
        typeof req.query.productId === 'string' ? req.query.productId : undefined;

      const where = productId ? { productId } : {};
      const [total, rows] = await Promise.all([
        prisma.inventoryAdjustment.count({ where }),
        prisma.inventoryAdjustment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            product: { select: { sku: true, name: true } },
          },
        }),
      ]);

      sendSuccess(
        res,
        rows.map((r) => ({
          id: r.id,
          productId: r.productId,
          type: r.type,
          quantityDelta: r.quantityDelta,
          reason: r.reason,
          product: r.product,
          createdAt: r.createdAt.toISOString(),
        })),
        200,
        buildPaginationMeta(page, limit, total),
      );
    } catch (err) {
      next(err);
    }
  },
);
