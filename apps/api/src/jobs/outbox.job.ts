/**
 * Outbox drain job — re-exported for module discoverability.
 * The worker process (`src/worker.ts`) runs this on an interval.
 */
export { drainOutbox, createNotificationWorker } from '../modules/notifications/notifications.service.js';
