import { Queue, Worker, type Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { getRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import {
  buildOrderEmail,
  createEmailAdapter,
  type EmailAdapter,
} from './email.adapter.js';

export const NOTIFICATION_QUEUE = 'notifications';

export interface NotificationJobData {
  outboxEventId: string;
  eventType: string;
  payload: {
    email: string;
    firstName?: string;
    orderId: string;
    totalCents?: number;
    reason?: string;
  };
}

let queue: Queue<NotificationJobData> | null = null;

export function getNotificationQueue(): Queue<NotificationJobData> {
  if (!queue) {
    queue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

/**
 * Drain pending outbox events into BullMQ jobs.
 * Safe to call periodically from the worker.
 */
export async function drainOutbox(limit = 50): Promise<number> {
  const events = await prisma.outboxEvent.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  if (events.length === 0) return 0;

  const q = getNotificationQueue();
  let enqueued = 0;

  for (const event of events) {
    const claimed = await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const payload = event.payload as NotificationJobData['payload'];
    try {
      // BullMQ custom job IDs cannot contain ':' — sanitize dedupeKey.
      // DB unique(dedupeKey) remains the primary exactly-once guard.
      const jobId = event.dedupeKey.replace(/:/g, '__');
      await q.add(
        event.eventType,
        {
          outboxEventId: event.id,
          eventType: event.eventType,
          payload,
        },
        {
          jobId,
        },
      );
      enqueued += 1;
    } catch (err) {
      logger.error({ err, outboxEventId: event.id }, 'Failed to enqueue outbox event');
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PENDING',
          lastError: err instanceof Error ? err.message : 'enqueue failed',
        },
      });
    }
  }

  return enqueued;
}

async function processNotificationJob(
  job: Job<NotificationJobData>,
  emailAdapter: EmailAdapter,
): Promise<void> {
  const { outboxEventId, eventType, payload } = job.data;

  const email = buildOrderEmail(
    eventType as 'order.created' | 'payment.succeeded' | 'payment.failed' | 'order.cancelled',
    {
      firstName: payload.firstName,
      orderId: payload.orderId,
      totalCents: payload.totalCents,
      reason: payload.reason,
    },
  );

  await emailAdapter.send({
    to: payload.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await prisma.outboxEvent.update({
    where: { id: outboxEventId },
    data: {
      status: 'COMPLETED',
      processedAt: new Date(),
      lastError: null,
    },
  });

  logger.info(
    { outboxEventId, eventType, to: payload.email, jobId: job.id },
    'Notification sent',
  );
}

export function createNotificationWorker(): Worker<NotificationJobData> {
  const emailAdapter = createEmailAdapter();

  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE,
    async (job) => processNotificationJob(job, emailAdapter),
    {
      connection: getRedis(),
      concurrency: 5,
    },
  );

  worker.on('failed', async (job, err) => {
    logger.error(
      { err, jobId: job?.id, data: job?.data },
      'Notification job failed',
    );
    if (job?.data.outboxEventId) {
      const maxAttempts = job.opts.attempts ?? 5;
      if ((job.attemptsMade ?? 0) >= maxAttempts) {
        await prisma.outboxEvent.update({
          where: { id: job.data.outboxEventId },
          data: {
            status: 'FAILED',
            lastError: err.message,
          },
        });
      } else {
        await prisma.outboxEvent.update({
          where: { id: job.data.outboxEventId },
          data: {
            status: 'PENDING',
            lastError: err.message,
          },
        });
      }
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Notification worker error');
  });

  return worker;
}

export async function closeNotificationQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
