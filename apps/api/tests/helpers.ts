import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';
import {
  signPaymentWebhook,
} from '../src/lib/crypto.js';
import { getEnv } from '../src/config/env.js';

export async function cleanDatabase() {
  const tables = [
    'payment_webhook_events',
    'idempotency_keys',
    'outbox_events',
    'audit_logs',
    'order_items',
    'payments',
    'orders',
    'cart_items',
    'carts',
    'inventory_adjustments',
    'inventory',
    'products',
    'refresh_tokens',
    'users',
  ];
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export async function createUser(
  opts: {
    email?: string;
    password?: string;
    role?: 'CUSTOMER' | 'STAFF' | 'ADMIN';
    firstName?: string;
    lastName?: string;
  } = {},
) {
  const password = opts.password ?? 'Password123!';
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `user-${randomUUID()}@test.local`,
      passwordHash: await hashPassword(password),
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? 'User',
      role: opts.role ?? 'CUSTOMER',
    },
  });
  return { user, password };
}

export async function login(
  app: Express,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };
}

export async function createProductWithStock(
  availableQuantity: number,
  priceCents = 1000,
  sku?: string,
) {
  return prisma.product.create({
    data: {
      sku: sku ?? `SKU-${randomUUID().slice(0, 8)}`,
      name: 'Test Product',
      description: 'test',
      priceCents,
      category: 'test',
      inventory: {
        create: {
          availableQuantity,
          reservedQuantity: 0,
          soldQuantity: 0,
        },
      },
    },
    include: { inventory: true },
  });
}

export function signedWebhookHeaders(body: string, eventId?: string) {
  const env = getEnv();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPaymentWebhook(env.PAYMENT_WEBHOOK_SECRET, timestamp, body);
  return {
    'Content-Type': 'application/json',
    'x-payment-signature': signature,
    'x-payment-timestamp': timestamp,
    'x-payment-event-id': eventId ?? `evt_${randomUUID()}`,
  };
}
