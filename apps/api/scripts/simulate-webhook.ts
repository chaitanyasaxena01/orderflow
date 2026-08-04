#!/usr/bin/env tsx
/**
 * Developer helper: send a signed payment webhook to the local API.
 *
 * Usage:
 *   npm run webhook:simulate -- --paymentId <uuid> --orderId <uuid> --event payment.succeeded
 *
 * Env:
 *   API_URL (default http://localhost:4000)
 *   PAYMENT_WEBHOOK_SECRET
 */
import { createHmac, randomUUID } from 'node:crypto';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith('--') && argv[i + 1]) {
      args[a.slice(2)] = argv[++i]!;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paymentId = args.paymentId;
  const orderId = args.orderId;
  const event = args.event ?? 'payment.succeeded';
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;

  if (!paymentId || !orderId) {
    console.error(
      'Usage: npm run webhook:simulate -- --paymentId <uuid> --orderId <uuid> [--event payment.succeeded|payment.failed|payment.refunded]',
    );
    process.exit(1);
  }
  if (!secret) {
    console.error('PAYMENT_WEBHOOK_SECRET env var is required');
    process.exit(1);
  }

  const body = JSON.stringify({
    event,
    paymentId,
    orderId,
    reason: event === 'payment.failed' ? 'simulated failure' : undefined,
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const eventId = args.eventId ?? `evt_${randomUUID()}`;

  const res = await fetch(`${apiUrl}/api/v1/webhooks/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-payment-signature': signature,
      'x-payment-timestamp': timestamp,
      'x-payment-event-id': eventId,
    },
    body,
  });

  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
