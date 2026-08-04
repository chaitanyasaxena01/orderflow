import { Router } from 'express';
import {
  createProductSchema,
  productListQuerySchema,
  updateProductSchema,
} from '@orderflow/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { sendSuccess } from '../../lib/response.js';
import { param } from '../../lib/params.js';
import * as productsService from './products.service.js';

export const productsRouter = Router();

productsRouter.get('/', validate(productListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const result = await productsService.listProducts(req.query as never);
    sendSuccess(res, result.products, 200, result.meta);
  } catch (err) {
    next(err);
  }
});

productsRouter.get('/:id', async (req, res, next) => {
  try {
    const product = await productsService.getProduct(param(req.params.id));
    sendSuccess(res, product);
  } catch (err) {
    next(err);
  }
});

productsRouter.post(
  '/',
  authenticate,
  authorize('STAFF', 'ADMIN'),
  validate(createProductSchema),
  async (req, res, next) => {
    try {
      const product = await productsService.createProduct(req.body);
      sendSuccess(res, product, 201);
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.patch(
  '/:id',
  authenticate,
  authorize('STAFF', 'ADMIN'),
  validate(updateProductSchema),
  async (req, res, next) => {
    try {
      const product = await productsService.updateProduct(param(req.params.id), req.body);
      sendSuccess(res, product);
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.delete(
  '/:id',
  authenticate,
  authorize('STAFF', 'ADMIN'),
  async (req, res, next) => {
    try {
      const product = await productsService.archiveProduct(param(req.params.id));
      sendSuccess(res, product);
    } catch (err) {
      next(err);
    }
  },
);
