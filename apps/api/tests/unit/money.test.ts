import { describe, expect, it } from 'vitest';
import { dollarsToCents, lineTotalCents, sumCents, formatMoney } from '@orderflow/shared';

describe('money helpers', () => {
  it('converts dollars to cents without float drift for common values', () => {
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1)).toBe(10);
  });

  it('computes line totals in integer cents', () => {
    expect(lineTotalCents(1999, 3)).toBe(5997);
  });

  it('sums cents', () => {
    expect(sumCents([100, 250, 50])).toBe(400);
  });

  it('formats money', () => {
    expect(formatMoney(1999)).toContain('19.99');
  });
});
