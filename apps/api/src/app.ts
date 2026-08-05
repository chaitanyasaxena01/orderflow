import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { getEnv } from './config/env.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { createGlobalRateLimiter, initRateLimiters } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { prisma } from './lib/prisma.js';
import { pingRedis } from './lib/redis.js';
import { getMetrics, incMetric } from './lib/metrics.js';
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
  // Construct rate limiters at bootstrap (required by express-rate-limit)
  initRateLimiters();

  const app = express();

  app.set('trust proxy', 1);

  app.use(requestIdMiddleware);
  app.use(requestLogger);
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

  app.use(createGlobalRateLimiter());
  app.use((_req, _res, next) => {
    incMetric('http.requests');
    next();
  });

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

      const [outboxPending, outboxFailed] = await Promise.all([
        prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
        prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      ]);

      res.json({
        success: true,
        data: {
          status: 'ready',
          database: true,
          redis: true,
          outbox: { pending: outboxPending, failed: outboxFailed },
        },
      });
    } catch (err) {
      logger.error({ err }, 'Readiness check failed');
      res.status(503).json({
        success: false,
        error: { code: 'NOT_READY', message: 'Dependencies unavailable' },
      });
    }
  });

  app.get('/metrics', (_req, res) => {
    res.json({ success: true, data: getMetrics() });
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
