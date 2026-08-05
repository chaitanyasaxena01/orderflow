import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RequestHandler } from 'express';
import { getRedis } from '../lib/redis.js';
import { getEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';

function createStore(prefix: string): RedisStore | undefined {
  try {
    const env = getEnv();
    if (env.NODE_ENV === 'test') return undefined;

    const client = getRedis();
    return new RedisStore({
      sendCommand: (...args: string[]) => {
        const [cmd, ...cmdArgs] = args;
        return client.call(cmd!, ...cmdArgs) as Promise<
          boolean | number | string | Array<boolean | number | string>
        >;
      },
      prefix: `rl:${prefix}:`,
    });
  } catch (err) {
    logger.warn({ err }, 'Redis rate-limit store unavailable; using memory store');
    return undefined;
  }
}

function baseMessage(code: string, message: string) {
  return {
    success: false as const,
    error: { code, message },
  };
}

let globalLimiter: RateLimitRequestHandler | null = null;
let authLimiter: RateLimitRequestHandler | null = null;

/**
 * Create rate limiters once during app bootstrap (not inside request handlers).
 * express-rate-limit forbids constructing middleware on the request path.
 */
export function initRateLimiters(): void {
  createGlobalRateLimiter();
  createAuthRateLimiter();
}

/** Global API rate limit — Redis-backed when Redis is available. */
export function createGlobalRateLimiter(): RateLimitRequestHandler {
  if (globalLimiter) return globalLimiter;

  const env = getEnv();
  const store = createStore('global');

  globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    skip: () => env.NODE_ENV === 'test',
    message: baseMessage('RATE_LIMITED', 'Too many requests, please try again later'),
    validate: { creationStack: false },
  });
  return globalLimiter;
}

/** Stricter limits for auth endpoints (brute-force protection). */
export function createAuthRateLimiter(): RateLimitRequestHandler {
  if (authLimiter) return authLimiter;

  const env = getEnv();
  const store = createStore('auth');

  authLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    skip: () => env.NODE_ENV === 'test',
    message: baseMessage(
      'AUTH_RATE_LIMITED',
      'Too many authentication attempts; try again shortly',
    ),
    validate: { creationStack: false },
  });
  return authLimiter;
}

/** Uses the singleton created by initRateLimiters / createAuthRateLimiter. */
export const authRateLimitMiddleware: RequestHandler = (req, res, next) => {
  createAuthRateLimiter()(req, res, next);
};
