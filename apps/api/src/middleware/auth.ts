import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedError('Missing access token');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account is not active');
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

/** Optional auth — attaches user if token present, otherwise continues. */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  return authenticate(req, _res, next);
}
