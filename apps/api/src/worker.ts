import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import {
  closeNotificationQueue,
  createNotificationWorker,
  drainOutbox,
} from './modules/notifications/notifications.service.js';

async function main() {
  loadEnv();
  await connectRedis();

  const worker = createNotificationWorker();
  logger.info('Notification worker started');

  // Periodically drain outbox → queue
  const interval = setInterval(() => {
    void drainOutbox().then((n) => {
      if (n > 0) logger.info({ enqueued: n }, 'Outbox drained');
    }).catch((err) => logger.error({ err }, 'Outbox drain failed'));
  }, 2000);

  // Initial drain
  void drainOutbox().catch((err) => logger.error({ err }, 'Initial outbox drain failed'));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker...');
    clearInterval(interval);
    await worker.close();
    await closeNotificationQueue();
    await disconnectPrisma();
    await disconnectRedis();
    logger.info('Worker shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start worker');
  process.exit(1);
});
