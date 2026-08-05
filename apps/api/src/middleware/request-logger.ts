import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

/** Log method, path, status, duration, and requestId (no secrets). */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const userId = req.user?.id;
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId,
      },
      'request completed',
    );
  });

  next();
}
