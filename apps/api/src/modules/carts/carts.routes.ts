import { Router } from 'express';
import { cartItemSchema, updateCartItemSchema } from '@orderflow/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { sendSuccess } from '../../lib/response.js';
import { param } from '../../lib/params.js';
import * as cartsService from './carts.service.js';

export const cartsRouter = Router();

cartsRouter.use(authenticate, authorize('CUSTOMER', 'STAFF', 'ADMIN'));

cartsRouter.get('/', async (req, res, next) => {
  try {
    const cart = await cartsService.getCart(req.user!.id);
    sendSuccess(res, cart);
  } catch (err) {
    next(err);
  }
});

cartsRouter.post('/items', validate(cartItemSchema), async (req, res, next) => {
  try {
    const cart = await cartsService.addItem(
      req.user!.id,
      req.body.productId,
      req.body.quantity,
    );
    sendSuccess(res, cart, 201);
  } catch (err) {
    next(err);
  }
});

cartsRouter.patch(
  '/items/:productId',
  validate(updateCartItemSchema),
  async (req, res, next) => {
    try {
      const cart = await cartsService.updateItem(
        req.user!.id,
        param(req.params.productId),
        req.body.quantity,
      );
      sendSuccess(res, cart);
    } catch (err) {
      next(err);
    }
  },
);

cartsRouter.delete('/items/:productId', async (req, res, next) => {
  try {
    const cart = await cartsService.removeItem(req.user!.id, param(req.params.productId));
    sendSuccess(res, cart);
  } catch (err) {
    next(err);
  }
});

cartsRouter.delete('/', async (req, res, next) => {
  try {
    const cart = await cartsService.clearCart(req.user!.id);
    sendSuccess(res, cart);
  } catch (err) {
    next(err);
  }
});
