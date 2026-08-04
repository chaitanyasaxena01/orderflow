import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { cleanDatabase, createUser, login } from '../helpers.js';
import { disconnectPrisma } from '../../src/lib/prisma.js';

describe('product RBAC', () => {
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

  it('forbids customers from creating products', async () => {
    const { user, password } = await createUser({ role: 'CUSTOMER' });
    const { accessToken } = await login(app, user.email, password);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sku: 'SKU1',
        name: 'Nope',
        priceCents: 100,
      });
    expect(res.status).toBe(403);
  });

  it('allows staff to create and archive products', async () => {
    const { user, password } = await createUser({ role: 'STAFF' });
    const { accessToken } = await login(app, user.email, password);

    const created = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sku: 'SKU-STAFF-1',
        name: 'Staff Product',
        priceCents: 2500,
        initialQuantity: 5,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.sku).toBe('SKU-STAFF-1');
    expect(created.body.data.inventory.availableQuantity).toBe(5);

    const archived = await request(app)
      .delete(`/api/v1/products/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);

    const get = await request(app).get(`/api/v1/products/${created.body.data.id}`);
    expect(get.status).toBe(404);
  });

  it('returns 401 without auth for protected routes', async () => {
    const res = await request(app).post('/api/v1/products').send({
      sku: 'X',
      name: 'Y',
      priceCents: 1,
    });
    expect(res.status).toBe(401);
  });
});
