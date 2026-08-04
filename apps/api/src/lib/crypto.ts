import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function generateIdempotencyRequestHash(body: unknown): string {
  const normalized = JSON.stringify(body ?? {});
  return sha256(normalized);
}

/**
 * HMAC-SHA256 signature for payment webhooks.
 * Signed payload: `${timestamp}.${rawBody}`
 */
export function signPaymentWebhook(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyPaymentWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = signPaymentWebhook(secret, timestamp, rawBody);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isTimestampFresh(timestampSec: number, toleranceSec: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestampSec) <= toleranceSec;
}
