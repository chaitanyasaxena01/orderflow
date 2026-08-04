import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { sendError } from '../lib/response.js';
import { getEnv } from '../config/env.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, err.message);
    } else {
      logger.warn({ err: { code: err.code, message: err.message }, requestId }, err.message);
    }
    sendError(res, err.statusCode, err.code, err.message, requestId, err.details);
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', requestId, err.flatten());
    return;
  }

  // Prisma serialization / write conflicts
  if (err && typeof err === 'object' && 'code' in err) {
    const prismaErr = err as { code?: string; message?: string; meta?: { message?: string } };
    if (prismaErr.code === 'P2034' || prismaErr.code === 'P2010') {
      const message = prismaErr.meta?.message ?? prismaErr.message ?? '';
      if (
        message.includes('concurrent') ||
        message.includes('40001') ||
        prismaErr.code === 'P2034'
      ) {
        sendError(
          res,
          409,
          'CHECKOUT_CONFLICT',
          'Concurrent update conflict; please retry',
          requestId,
        );
        return;
      }
    }
  }

  logger.error({ err, requestId }, 'Unhandled error');

  const isProd = (() => {
    try {
      return getEnv().NODE_ENV === 'production';
    } catch {
      return process.env.NODE_ENV === 'production';
    }
  })();

  sendError(
    res,
    500,
    'INTERNAL_ERROR',
    isProd ? 'An unexpected error occurred' : err instanceof Error ? err.message : 'Unknown error',
    requestId,
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`, req.requestId);
}
