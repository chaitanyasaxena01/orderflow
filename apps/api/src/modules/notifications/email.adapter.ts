import { getEnv } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<void> {
    logger.info(
      {
        email: {
          to: message.to,
          subject: message.subject,
          text: message.text,
        },
      },
      'Console email adapter: message logged (no RESEND_API_KEY)',
    );
  }
}

export class ResendEmailAdapter implements EmailAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }
  }
}

export function createEmailAdapter(): EmailAdapter {
  const env = getEnv();
  if (env.RESEND_API_KEY && env.RESEND_API_KEY.length > 0) {
    logger.info('Using Resend email adapter');
    return new ResendEmailAdapter(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  logger.info('Using console email adapter');
  return new ConsoleEmailAdapter();
}

export function buildOrderEmail(
  type: 'order.created' | 'payment.succeeded' | 'payment.failed' | 'order.cancelled',
  payload: {
    firstName?: string;
    orderId: string;
    totalCents?: number;
    reason?: string;
  },
): { subject: string; html: string; text: string } {
  const name = payload.firstName ?? 'there';
  const total =
    payload.totalCents !== undefined
      ? `$${(payload.totalCents / 100).toFixed(2)}`
      : '';

  switch (type) {
    case 'order.created':
      return {
        subject: `Order confirmed — ${payload.orderId.slice(0, 8)}`,
        text: `Hi ${name}, your order ${payload.orderId} for ${total} was created and is awaiting payment.`,
        html: `<p>Hi ${name},</p><p>Your order <strong>${payload.orderId}</strong> for <strong>${total}</strong> was created and is awaiting payment.</p>`,
      };
    case 'payment.succeeded':
      return {
        subject: `Payment received — ${payload.orderId.slice(0, 8)}`,
        text: `Hi ${name}, payment for order ${payload.orderId} (${total}) succeeded. We are preparing your order.`,
        html: `<p>Hi ${name},</p><p>Payment for order <strong>${payload.orderId}</strong> (${total}) succeeded. We are preparing your order.</p>`,
      };
    case 'payment.failed':
      return {
        subject: `Payment failed — ${payload.orderId.slice(0, 8)}`,
        text: `Hi ${name}, payment for order ${payload.orderId} failed. ${payload.reason ?? ''}`.trim(),
        html: `<p>Hi ${name},</p><p>Payment for order <strong>${payload.orderId}</strong> failed. ${payload.reason ?? ''}</p>`,
      };
    case 'order.cancelled':
      return {
        subject: `Order cancelled — ${payload.orderId.slice(0, 8)}`,
        text: `Hi ${name}, your order ${payload.orderId} has been cancelled.`,
        html: `<p>Hi ${name},</p><p>Your order <strong>${payload.orderId}</strong> has been cancelled.</p>`,
      };
  }
}
