import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, buildPaginationMeta } from '../../lib/response.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { paginationSchema } from '@orderflow/shared';

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
    const [users, products, orders, pendingPayments] = await Promise.all([
      prisma.user.count(),
      prisma.product.count({ where: { archivedAt: null } }),
      prisma.order.count(),
      prisma.payment.count({ where: { status: 'PENDING' } }),
    ]);
    sendSuccess(res, { users, products, orders, pendingPayments });
  } catch (err) {
    next(err);
  }
});
