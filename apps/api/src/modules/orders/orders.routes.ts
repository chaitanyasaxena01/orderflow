import { Router } from 'express';
import { paginationSchema } from '@orderflow/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { sendSuccess } from '../../lib/response.js';
import { param } from '../../lib/params.js';
import * as ordersService from './orders.service.js';

export const ordersRouter = Router();
export const checkoutRouter = Router();

checkoutRouter.post('/', authenticate, async (req, res, next) => {
  try {
    const idempotencyKey = req.header('idempotency-key') ?? undefined;
    const result = await ordersService.checkout(req.user!.id, idempotencyKey, req.body ?? {});
    if (result.fromCache) {
      res.status(result.status).json(result.body);
      return;
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

ordersRouter.use(authenticate);

ordersRouter.get(
  '/',
  authorize('CUSTOMER', 'STAFF', 'ADMIN'),
  validate(paginationSchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as { page: number; limit: number };
      const result = await ordersService.listOrders(req.user!.id, req.user!.role, page, limit);
      sendSuccess(res, result.orders, 200, result.meta);
    } catch (err) {
      next(err);
    }
  },
);

ordersRouter.get('/:id', authorize('CUSTOMER', 'STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const order = await ordersService.getOrder(
      param(req.params.id),
      req.user!.id,
      req.user!.role,
    );
    sendSuccess(res, order);
  } catch (err) {
    next(err);
  }
});

ordersRouter.post(
  '/:id/cancel',
  authorize('CUSTOMER', 'ADMIN'),
  async (req, res, next) => {
    try {
      const order = await ordersService.cancelOrder(
        param(req.params.id),
        req.user!.id,
        req.user!.role,
      );
      sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  },
);

ordersRouter.post(
  '/:id/process',
  authorize('STAFF', 'ADMIN'),
  async (req, res, next) => {
    try {
      const order = await ordersService.transitionOrder(
        param(req.params.id),
        'process',
        req.user!.id,
        req.user!.role,
      );
      sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  },
);

ordersRouter.post(
  '/:id/ship',
  authorize('STAFF', 'ADMIN'),
  async (req, res, next) => {
    try {
      const order = await ordersService.transitionOrder(
        param(req.params.id),
        'ship',
        req.user!.id,
        req.user!.role,
      );
      sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  },
);

ordersRouter.post(
  '/:id/complete',
  authorize('STAFF', 'ADMIN'),
  async (req, res, next) => {
    try {
      const order = await ordersService.transitionOrder(
        param(req.params.id),
        'complete',
        req.user!.id,
        req.user!.role,
      );
      sendSuccess(res, order);
    } catch (err) {
      next(err);
    }
  },
);
