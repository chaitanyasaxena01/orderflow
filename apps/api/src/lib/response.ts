import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  status = 200,
  meta?: PaginationMeta | Record<string, unknown>,
): void {
  res.status(status).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId?: string,
  details?: unknown,
): void {
  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined ? { details } : {}),
    },
  });
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
