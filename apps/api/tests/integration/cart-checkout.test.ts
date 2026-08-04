import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import {
  cleanDatabase,
  createProductWithStock,
  createUser,
  login,
  signedWebhookHeaders,
} from '../helpers.js';
import { disconnectPrisma, prisma } from '../../src/lib/prisma.js';

describe('cart and checkout', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('adds items and checks out successfully', async () => {
    const product = await createProductWithStock(10, 1500);
    const { user, password } = await createUser({ role: 'CUSTOMER' });
    const { accessToken } = await login(app, user.email, password);

    const cart = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 2 });
    expect(cart.status).toBe(201);
    expect(cart.body.data.totalCents).toBe(3000);

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'checkout-key-1')
      .send({});
    expect(checkout.status).toBe(201);
    expect(checkout.body.data.status).toBe('PENDING_PAYMENT');
    expect(checkout.body.data.payment.status).toBe('PENDING');
    expect(checkout.body.data.items).toHaveLength(1);
    expect(checkout.body.data.items[0].productName).toBe('Test Product');

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inv.availableQuantity).toBe(8);
    expect(inv.reservedQuantity).toBe(2);
  });

  it('rejects checkout with insufficient inventory', async () => {
    const product = await createProductWithStock(1, 1000);
    const { user, password } = await createUser();
    const { accessToken } = await login(app, user.email, password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    // Force inventory down after cart add
    await prisma.inventory.update({
      where: { productId: product.id },
      data: { availableQuantity: 0 },
    });

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'checkout-fail-1')
      .send({});
    expect(checkout.status).toBe(409);
    expect(checkout.body.error.code).toBe('INSUFFICIENT_INVENTORY');

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inv.availableQuantity).toBe(0);
    expect(inv.reservedQuantity).toBe(0);
  });

  it('returns cached response for duplicate checkout idempotency key', async () => {
    const product = await createProductWithStock(5, 1000);
    const { user, password } = await createUser();
    const { accessToken } = await login(app, user.email, password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    const first = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'same-key')
      .send({});
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'same-key')
      .send({});
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const orderCount = await prisma.order.count({ where: { userId: user.id } });
    expect(orderCount).toBe(1);
  });

  it('prevents customer from accessing another customer order', async () => {
    const product = await createProductWithStock(5, 1000);
    const a = await createUser({ email: 'a@test.local' });
    const b = await createUser({ email: 'b@test.local' });
    const aTok = await login(app, a.user.email, a.password);
    const bTok = await login(app, b.user.email, b.password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${aTok.accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${aTok.accessToken}`)
      .set('Idempotency-Key', 'order-a')
      .send({});
    const orderId = checkout.body.data.id;

    const denied = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${bTok.accessToken}`);
    expect(denied.status).toBe(403);
  });

  it('handles payment success and duplicate webhook', async () => {
    const product = await createProductWithStock(3, 1000);
    const { user, password } = await createUser();
    const { accessToken } = await login(app, user.email, password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'pay-ok')
      .send({});

    const orderId = checkout.body.data.id as string;
    const paymentId = checkout.body.data.payment.id as string;
    const body = JSON.stringify({
      event: 'payment.succeeded',
      paymentId,
      orderId,
    });
    const headers = signedWebhookHeaders(body, 'evt-dup-1');

    const wh1 = await request(app).post('/api/v1/webhooks/payments').set(headers).send(body);
    expect(wh1.status).toBe(200);
    expect(wh1.body.data.duplicate).toBe(false);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inv.reservedQuantity).toBe(0);
    expect(inv.soldQuantity).toBe(1);

    const wh2 = await request(app).post('/api/v1/webhooks/payments').set(headers).send(body);
    expect(wh2.status).toBe(200);
    expect(wh2.body.data.duplicate).toBe(true);
  });

  it('releases inventory on payment failed', async () => {
    const product = await createProductWithStock(2, 1000);
    const { user, password } = await createUser();
    const { accessToken } = await login(app, user.email, password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'pay-fail')
      .send({});

    const orderId = checkout.body.data.id as string;
    const paymentId = checkout.body.data.payment.id as string;
    const body = JSON.stringify({
      event: 'payment.failed',
      paymentId,
      orderId,
      reason: 'card declined',
    });
    const headers = signedWebhookHeaders(body);

    const wh = await request(app).post('/api/v1/webhooks/payments').set(headers).send(body);
    expect(wh.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAYMENT_FAILED');

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inv.availableQuantity).toBe(2);
    expect(inv.reservedQuantity).toBe(0);
  });
});
