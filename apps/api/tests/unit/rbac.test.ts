import { describe, expect, it } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authorize } from '../../src/middleware/auth.js';
import { ForbiddenError, UnauthorizedError } from '../../src/lib/errors.js';

function mockReq(user?: { role: 'CUSTOMER' | 'STAFF' | 'ADMIN' }): Request {
  return { user } as unknown as Request;
}

describe('authorize middleware', () => {
  it('rejects unauthenticated users with 401 semantics', () => {
    const mw = authorize('ADMIN');
    let err: unknown;
    mw(mockReq(), {} as Response, ((e?: unknown) => {
      err = e;
    }) as NextFunction);
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects wrong role with 403 semantics', () => {
    const mw = authorize('ADMIN');
    let err: unknown;
    mw(mockReq({ role: 'CUSTOMER' }), {} as Response, ((e?: unknown) => {
      err = e;
    }) as NextFunction);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('allows matching role', () => {
    const mw = authorize('STAFF', 'ADMIN');
    let called = false;
    mw(mockReq({ role: 'STAFF' }), {} as Response, ((e?: unknown) => {
      if (!e) called = true;
    }) as NextFunction);
    expect(called).toBe(true);
  });
});
