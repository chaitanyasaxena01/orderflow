export const ROLES = {
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const ORDER_STATUSES = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export const PAYMENT_EVENTS = {
  SUCCEEDED: 'payment.succeeded',
  FAILED: 'payment.failed',
  REFUNDED: 'payment.refunded',
} as const;

export const OUTBOX_EVENT_TYPES = {
  ORDER_CREATED: 'order.created',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  ORDER_CANCELLED: 'order.cancelled',
} as const;

export const IDEMPOTENCY_SCOPES = {
  CHECKOUT: 'POST /api/v1/checkout',
} as const;

/** Order status transitions that are allowed. */
export const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['PROCESSING', 'REFUNDED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['COMPLETED', 'REFUNDED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionOrder(from: string, to: string): boolean {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
