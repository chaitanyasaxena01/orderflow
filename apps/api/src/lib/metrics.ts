/**
 * Lightweight in-process metrics for portfolio observability.
 * Not a full Prometheus server — counters only.
 */

type CounterMap = Record<string, number>;

const counters: CounterMap = {
  'http.requests': 0,
  'checkout.success': 0,
  'checkout.conflict': 0,
  'webhook.processed': 0,
  'webhook.duplicate': 0,
  'outbox.enqueued': 0,
  'outbox.completed': 0,
  'outbox.failed': 0,
  'notifications.sent': 0,
};

export function incMetric(name: keyof typeof counters | string, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

export function getMetrics(): CounterMap {
  return { ...counters };
}

export function resetMetrics(): void {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}
