import { describe, expect, it } from 'vitest';
import { canTransitionOrder } from '@orderflow/shared';

describe('order status transitions', () => {
  it('allows pending payment to paid/failed/cancelled', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransitionOrder('PENDING_PAYMENT', 'PAYMENT_FAILED')).toBe(true);
    expect(canTransitionOrder('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
  });

  it('does not allow transitions from terminal states', () => {
    expect(canTransitionOrder('CANCELLED', 'PAID')).toBe(false);
    expect(canTransitionOrder('REFUNDED', 'PAID')).toBe(false);
  });
});
