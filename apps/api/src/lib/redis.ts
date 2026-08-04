import { Redis } from 'ioredis';
import { logger } from './logger.js';

let redis: Redis | null = null;

export function getRedis(url?: string): Redis {
  if (redis) return redis;

  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Redis error');
  });

  return redis;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => redis?.disconnect());
    redis = null;
    logger.info('Redis disconnected');
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    if (client.status !== 'ready') {
      await connectRedis();
    }
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
