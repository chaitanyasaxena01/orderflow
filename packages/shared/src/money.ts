/**
 * Money helpers using integer minor units (cents / paise).
 * Never use floating-point arithmetic for currency.
 */

export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error('Invalid money amount');
  }
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(centsToDollars(cents));
}

export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  if (!Number.isInteger(unitPriceCents) || !Number.isInteger(quantity)) {
    throw new Error('unitPriceCents and quantity must be integers');
  }
  if (unitPriceCents < 0 || quantity < 0) {
    throw new Error('unitPriceCents and quantity must be non-negative');
  }
  return unitPriceCents * quantity;
}

export function sumCents(amounts: number[]): number {
  return amounts.reduce((sum, n) => {
    if (!Number.isInteger(n)) {
      throw new Error('All amounts must be integer cents');
    }
    return sum + n;
  }, 0);
}
