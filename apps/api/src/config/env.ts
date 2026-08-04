import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1).optional(),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'PAYMENT_WEBHOOK_SECRET is required'),

  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('OrderFlow <onboarding@resend.dev>'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  WEBHOOK_TIMESTAMP_TOLERANCE_SEC: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  if (cached && process.env.NODE_ENV !== 'test') {
    return cached;
  }

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = result.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export function getEnv(): Env {
  if (!cached) {
    return loadEnv();
  }
  return cached;
}
