import { Router } from 'express';
import { loginSchema, registerSchema } from '@orderflow/shared';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { authRateLimitMiddleware } from '../../middleware/rate-limit.js';
import { sendSuccess } from '../../lib/response.js';
import * as authService from './auth.service.js';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimitMiddleware,
  validate(registerSchema),
  async (req, res, next) => {
    try {
      const result = await authService.register(req.body);
      sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/login',
  authRateLimitMiddleware,
  validate(loginSchema),
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/refresh',
  authRateLimitMiddleware,
  validate(refreshSchema),
  async (req, res, next) => {
    try {
      const result = await authService.refresh(req.body.refreshToken);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post('/logout', validate(logoutSchema), async (req, res, next) => {
  try {
    const result = await authService.logout(req.body.refreshToken);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    const result = await authService.logoutAll(req.user!.id);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await authService.getMe(req.user!.id);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});
