import { Router } from 'express';
import { adjustInventorySchema, paginationSchema, restockSchema } from '@orderflow/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { sendSuccess } from '../../lib/response.js';
import { param } from '../../lib/params.js';
import * as inventoryService from './inventory.service.js';

export const inventoryRouter = Router();

inventoryRouter.use(authenticate, authorize('STAFF', 'ADMIN'));

inventoryRouter.get('/', validate(paginationSchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const result = await inventoryService.listInventory(page, limit);
    sendSuccess(res, result.inventory, 200, result.meta);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/:productId', async (req, res, next) => {
  try {
    const inv = await inventoryService.getInventory(param(req.params.productId));
    sendSuccess(res, inv);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post(
  '/:productId/restock',
  validate(restockSchema),
  async (req, res, next) => {
    try {
      const inv = await inventoryService.restock(
        param(req.params.productId),
        req.body.quantity,
        req.body.reason,
      );
      sendSuccess(res, inv);
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.patch(
  '/:productId',
  validate(adjustInventorySchema),
  async (req, res, next) => {
    try {
      const inv = await inventoryService.adjustInventory(
        param(req.params.productId),
        req.body.availableQuantity,
        req.body.reason,
      );
      sendSuccess(res, inv);
    } catch (err) {
      next(err);
    }
  },
);
