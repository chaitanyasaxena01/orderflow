import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { getEnv } from './config/env.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { prisma } from './lib/prisma.js';
import { pingRedis } from './lib/redis.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { cartsRouter } from './modules/carts/carts.routes.js';
import { ordersRouter, checkoutRouter } from './modules/orders/orders.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { logger } from './lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadOpenApiDoc(): Record<string, unknown> {
  const candidates = [
    path.resolve(__dirname, '../../../openapi/openapi.yaml'),
    path.resolve(process.cwd(), 'openapi/openapi.yaml'),
    path.resolve(process.cwd(), '../../openapi/openapi.yaml'),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf8');
      return YAML.parse(raw) as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'OrderFlow API', version: '1.0.0' },
    paths: {},
  };
}

export function createApp() {
  const env = getEnv();
  const app = express();

  app.set('trust proxy', 1);

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );

  // Capture raw body for webhook signature verification
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
      },
    },
    skip: () => env.NODE_ENV === 'test',
  });
  app.use(limiter);

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', service: 'orderflow-api', timestamp: new Date().toISOString() },
    });
  });

  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const redisOk = await pingRedis();
      if (!redisOk) {
        res.status(503).json({
          success: false,
          error: { code: 'NOT_READY', message: 'Redis unavailable' },
        });
        return;
      }
      res.json({
        success: true,
        data: { status: 'ready', database: true, redis: true },
      });
    } catch (err) {
      logger.error({ err }, 'Readiness check failed');
      res.status(503).json({
        success: false,
        error: { code: 'NOT_READY', message: 'Dependencies unavailable' },
      });
    }
  });

  const openApiDoc = loadOpenApiDoc();
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDoc);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc, { explorer: true }));

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/products', productsRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/cart', cartsRouter);
  app.use('/api/v1/checkout', checkoutRouter);
  app.use('/api/v1/orders', ordersRouter);
  app.use('/api/v1/webhooks', paymentsRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
