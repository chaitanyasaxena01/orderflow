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

describe('tier1/tier2 reliability features', () => {
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

  it('rejects suspended users from login', async () => {
    const { user, password } = await createUser({ email: 'sus@test.local' });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'SUSPENDED' },
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logout-all revokes refresh tokens', async () => {
    const { user, password } = await createUser();
    const tokens = await login(app, user.email, password);

    const logoutAll = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(logoutAll.status).toBe(200);
    expect(logoutAll.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('returns 409 when idempotency key is reused with different body', async () => {
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
      .set('Idempotency-Key', 'body-mismatch')
      .send({});
    expect(first.status).toBe(201);

    // Same key, different body hash
    const second = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'body-mismatch')
      .send({ note: 'different' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects stale payment webhooks', async () => {
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
      .set('Idempotency-Key', 'stale-wh')
      .send({});

    const orderId = checkout.body.data.id as string;
    const paymentId = checkout.body.data.payment.id as string;
    const body = JSON.stringify({
      event: 'payment.succeeded',
      paymentId,
      orderId,
    });

    // Craft stale timestamp
    const envSecret = process.env.PAYMENT_WEBHOOK_SECRET!;
    const crypto = await import('node:crypto');
    const timestamp = String(Math.floor(Date.now() / 1000) - 10_000);
    const signature = crypto
      .createHmac('sha256', envSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    const wh = await request(app)
      .post('/api/v1/webhooks/payments')
      .set({
        'Content-Type': 'application/json',
        'x-payment-signature': signature,
        'x-payment-timestamp': timestamp,
        'x-payment-event-id': 'evt-stale-1',
      })
      .send(body);

    expect(wh.status).toBe(401);
    expect(wh.body.error.code).toBe('STALE_WEBHOOK');
  });

  it('refund webhook restocks sold inventory', async () => {
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
      .set('Idempotency-Key', 'refund-1')
      .send({});

    const orderId = checkout.body.data.id as string;
    const paymentId = checkout.body.data.payment.id as string;

    const okBody = JSON.stringify({
      event: 'payment.succeeded',
      paymentId,
      orderId,
    });
    await request(app)
      .post('/api/v1/webhooks/payments')
      .set(signedWebhookHeaders(okBody, 'evt-ok-refund'))
      .send(okBody);

    const refundBody = JSON.stringify({
      event: 'payment.refunded',
      paymentId,
      orderId,
    });
    const refund = await request(app)
      .post('/api/v1/webhooks/payments')
      .set(signedWebhookHeaders(refundBody, 'evt-refund-1'))
      .send(refundBody);
    expect(refund.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('REFUNDED');

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inv.availableQuantity).toBe(3);
    expect(inv.soldQuantity).toBe(0);
  });

  it('forbids staff from admin user management', async () => {
    const { user, password } = await createUser({ role: 'STAFF' });
    const { accessToken } = await login(app, user.email, password);

    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('staff can process → ship → complete a paid order', async () => {
    const product = await createProductWithStock(5, 1000);
    const customer = await createUser({ role: 'CUSTOMER', email: 'buyer@test.local' });
    const staff = await createUser({ role: 'STAFF', email: 'stafff@test.local' });
    const cTok = await login(app, customer.user.email, customer.password);
    const sTok = await login(app, staff.user.email, staff.password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .set('Idempotency-Key', 'fulfill-1')
      .send({});

    const orderId = checkout.body.data.id as string;
    const paymentId = checkout.body.data.payment.id as string;
    const body = JSON.stringify({
      event: 'payment.succeeded',
      paymentId,
      orderId,
    });
    await request(app)
      .post('/api/v1/webhooks/payments')
      .set(signedWebhookHeaders(body, 'evt-fulfill'))
      .send(body);

    const process = await request(app)
      .post(`/api/v1/orders/${orderId}/process`)
      .set('Authorization', `Bearer ${sTok.accessToken}`);
    expect(process.status).toBe(200);
    expect(process.body.data.status).toBe('PROCESSING');

    const ship = await request(app)
      .post(`/api/v1/orders/${orderId}/ship`)
      .set('Authorization', `Bearer ${sTok.accessToken}`);
    expect(ship.status).toBe(200);
    expect(ship.body.data.status).toBe('SHIPPED');

    const complete = await request(app)
      .post(`/api/v1/orders/${orderId}/complete`)
      .set('Authorization', `Bearer ${sTok.accessToken}`);
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('COMPLETED');

    // Illegal transition
    const bad = await request(app)
      .post(`/api/v1/orders/${orderId}/process`)
      .set('Authorization', `Bearer ${sTok.accessToken}`);
    expect(bad.status).toBe(409);

    const audit = await prisma.auditLog.count({
      where: { entityType: 'Order', entityId: orderId },
    });
    expect(audit).toBeGreaterThanOrEqual(3);
  });

  it('uses current product price at checkout, not cart-time price', async () => {
    const product = await createProductWithStock(5, 1000);
    const { user, password } = await createUser();
    const { accessToken } = await login(app, user.email, password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    await prisma.product.update({
      where: { id: product.id },
      data: { priceCents: 2500 },
    });

    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'price-snap')
      .send({});
    expect(checkout.status).toBe(201);
    expect(checkout.body.data.totalCents).toBe(2500);
    expect(checkout.body.data.items[0].unitPriceCents).toBe(2500);
  });

  it('admin can list outbox and redrive failed events', async () => {
    const admin = await createUser({ role: 'ADMIN', email: 'adm@test.local' });
    const { accessToken } = await login(app, admin.user.email, admin.password);

    await prisma.outboxEvent.create({
      data: {
        eventType: 'order.created',
        dedupeKey: 'order.created:test-fail',
        payload: { email: 'x@y.com', orderId: '00000000-0000-0000-0000-000000000099' },
        status: 'FAILED',
        lastError: 'simulated',
      },
    });

    const list = await request(app)
      .get('/api/v1/admin/outbox?status=FAILED')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const redrive = await request(app)
      .post('/api/v1/admin/outbox/redrive')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(redrive.status).toBe(200);
    expect(redrive.body.data.redriven).toBeGreaterThanOrEqual(1);

    const pending = await prisma.outboxEvent.count({ where: { status: 'PENDING' } });
    expect(pending).toBeGreaterThanOrEqual(1);
  });

  it('exposes readiness outbox counts and metrics', async () => {
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.outbox).toBeDefined();

    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.body.data).toHaveProperty('http.requests');
  });

  it('lists inventory adjustments for a product', async () => {
    const product = await createProductWithStock(1, 500);
    const staff = await createUser({ role: 'STAFF' });
    const { accessToken } = await login(app, staff.user.email, staff.password);

    await request(app)
      .post(`/api/v1/inventory/${product.id}/restock`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ quantity: 4, reason: 'test restock' });

    const adj = await request(app)
      .get(`/api/v1/inventory/${product.id}/adjustments`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(adj.status).toBe(200);
    expect(adj.body.data.some((a: { type: string }) => a.type === 'RESTOCK')).toBe(true);
    expect(adj.body.meta).toBeDefined();
  });
});
