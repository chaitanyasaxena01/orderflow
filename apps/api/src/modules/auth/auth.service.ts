import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  parseDurationToMs,
} from '../../lib/jwt.js';
import { generateRefreshToken, hashToken } from '../../lib/crypto.js';
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../lib/errors.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { RegisterInput, LoginInput } from '@orderflow/shared';

function publicUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('EMAIL_EXISTS', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: 'CUSTOMER',
    },
  });

  const tokens = await issueTokens(user.id, user.email, user.role);
  return { user: publicUser(user), ...tokens };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }
  if (user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Account is not active');
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const tokens = await issueTokens(user.id, user.email, user.role);
  return { user: publicUser(user), ...tokens };
}

async function issueTokens(userId: string, email: string, role: 'CUSTOMER' | 'STAFF' | 'ADMIN') {
  const env = getEnv();
  const jti = randomUUID();
  const rawRefresh = generateRefreshToken();
  const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));

  await prisma.refreshToken.create({
    data: {
      id: jti,
      userId,
      tokenHash: hashToken(rawRefresh),
      expiresAt,
    },
  });

  const accessToken = signAccessToken({ sub: userId, email, role });
  const refreshTokenJwt = signRefreshToken({ sub: userId, jti });

  // Store hash of the JWT for revocation lookups
  await prisma.refreshToken.update({
    where: { id: jti },
    data: { tokenHash: hashToken(refreshTokenJwt) },
  });

  return {
    accessToken,
    refreshToken: refreshTokenJwt,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  };
}

/** Revoke every refresh token for a user (session family / logout-all). */
export async function revokeAllRefreshTokens(userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function refresh(refreshToken: string) {
  if (!refreshToken) {
    throw new ValidationError('refreshToken is required');
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { id: payload.jti },
    include: { user: true },
  });

  // Reuse of an already-revoked token → revoke entire session family for that user
  if (stored?.revokedAt) {
    const revoked = await revokeAllRefreshTokens(stored.userId);
    logger.warn(
      { userId: stored.userId, jti: payload.jti, revoked },
      'Refresh token reuse detected; revoked token family',
    );
    throw new UnauthorizedError('Refresh token reuse detected');
  }

  if (!stored || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token revoked or expired');
  }

  if (stored.tokenHash !== hashToken(refreshToken)) {
    const revoked = await revokeAllRefreshTokens(stored.userId);
    logger.warn(
      { userId: stored.userId, jti: payload.jti, revoked },
      'Refresh token hash mismatch; revoked token family',
    );
    throw new UnauthorizedError('Refresh token reuse detected');
  }

  if (stored.user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Account is not active');
  }

  // Rotate: revoke old, issue new
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokens(stored.user.id, stored.user.email, stored.user.role);
  return { user: publicUser(stored.user), ...tokens };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) {
    return { success: true };
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { id: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // Idempotent logout
  }

  return { success: true };
}

export async function logoutAll(userId: string) {
  const count = await revokeAllRefreshTokens(userId);
  return { success: true, revokedSessions: count };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found', 404);
  }
  return publicUser(user);
}
