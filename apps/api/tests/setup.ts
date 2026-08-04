import { beforeAll } from 'vitest';
import { loadEnv, resetEnvCache } from '../src/config/env.js';

beforeAll(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.PORT = process.env.PORT ?? '4000';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://orderflow:orderflow@localhost:5432/orderflow_test?schema=public';
  process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-32-characters!!';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-32-characters!';
  process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  process.env.PAYMENT_WEBHOOK_SECRET =
    process.env.PAYMENT_WEBHOOK_SECRET ?? 'test-payment-webhook-secret-32chars';
  process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';

  resetEnvCache();
  loadEnv();
});
