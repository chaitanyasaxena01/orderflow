import { describe, expect, it } from 'vitest';
import {
  generateIdempotencyRequestHash,
  signPaymentWebhook,
  verifyPaymentWebhookSignature,
  isTimestampFresh,
} from '../../src/lib/crypto.js';

describe('crypto helpers', () => {
  it('hashes request bodies for idempotency', () => {
    const a = generateIdempotencyRequestHash({ a: 1 });
    const b = generateIdempotencyRequestHash({ a: 1 });
    const c = generateIdempotencyRequestHash({ a: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('validates HMAC webhook signatures', () => {
    const secret = 'test-secret';
    const timestamp = '1700000000';
    const body = '{"event":"payment.succeeded"}';
    const sig = signPaymentWebhook(secret, timestamp, body);
    expect(verifyPaymentWebhookSignature(secret, timestamp, body, sig)).toBe(true);
    expect(verifyPaymentWebhookSignature(secret, timestamp, body, '00' + sig.slice(2))).toBe(
      false,
    );
  });

  it('checks timestamp freshness', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTimestampFresh(now, 300)).toBe(true);
    expect(isTimestampFresh(now - 1000, 300)).toBe(false);
  });
});
