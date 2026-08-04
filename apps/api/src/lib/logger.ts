import pino from 'pino';
import { getEnv } from '../config/env.js';

const isDev = () => {
  try {
    return getEnv().NODE_ENV === 'development';
  } catch {
    return process.env.NODE_ENV !== 'production';
  }
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isDev()
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'accessToken',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PAYMENT_WEBHOOK_SECRET',
      'RESEND_API_KEY',
    ],
    remove: true,
  },
});

export type Logger = typeof logger;
