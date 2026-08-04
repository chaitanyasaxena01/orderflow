import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';

async function main() {
  const env = loadEnv();
  await connectRedis();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'OrderFlow API listening');
  });

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API...');

    server.close(async () => {
      try {
        await disconnectPrisma();
        await disconnectRedis();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
