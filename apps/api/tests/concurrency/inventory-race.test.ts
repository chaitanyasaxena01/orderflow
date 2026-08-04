import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import {
  cleanDatabase,
  createProductWithStock,
  createUser,
  login,
} from '../helpers.js';
import { disconnectPrisma, prisma } from '../../src/lib/prisma.js';

describe('inventory concurrency', () => {
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

  it('allows only one checkout when two users race for the last unit', async () => {
    const product = await createProductWithStock(1, 999);
    const userA = await createUser({ email: 'race-a@test.local' });
    const userB = await createUser({ email: 'race-b@test.local' });
    const tokA = await login(app, userA.user.email, userA.password);
    const tokB = await login(app, userB.user.email, userB.password);

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${tokA.accessToken}`)
      .send({ productId: product.id, quantity: 1 });
    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${tokB.accessToken}`)
      .send({ productId: product.id, quantity: 1 });

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${tokA.accessToken}`)
        .set('Idempotency-Key', 'race-a')
        .send({}),
      request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${tokB.accessToken}`)
        .set('Idempotency-Key', 'race-b')
        .send({}),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const success = resA.status === 201 ? resA : resB;
    const fail = resA.status === 201 ? resB : resA;
    expect(success.body.data.status).toBe('PENDING_PAYMENT');
    expect(fail.body.error.code).toBe('INSUFFICIENT_INVENTORY');

    const orders = await prisma.order.findMany();
    expect(orders).toHaveLength(1);

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inv.availableQuantity).toBe(0);
    expect(inv.reservedQuantity).toBe(1);
    expect(inv.availableQuantity + inv.reservedQuantity).toBeGreaterThanOrEqual(0);
    expect(inv.availableQuantity).toBeGreaterThanOrEqual(0);
    expect(inv.reservedQuantity).toBeGreaterThanOrEqual(0);
  });
});
