import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { cleanDatabase, createUser, login } from '../helpers.js';
import { disconnectPrisma } from '../../src/lib/prisma.js';

describe('auth integration', () => {
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

  it('registers and logs in a user', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      email: 'new@example.com',
      password: 'Password123!',
      firstName: 'New',
      lastName: 'User',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.accessToken).toBeTruthy();
    expect(reg.body.data.user.email).toBe('new@example.com');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('new@example.com');
  });

  it('rotates refresh tokens', async () => {
    const { user, password } = await createUser({ email: 'rot@example.com' });
    const tokens = await login(app, user.email, password);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    expect(refreshed.body.data.refreshToken).not.toBe(tokens.refreshToken);

    // Old refresh token should be revoked
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('logs out and revokes refresh token', async () => {
    const { user, password } = await createUser({ email: 'out@example.com' });
    const tokens = await login(app, user.email, password);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(logout.status).toBe(200);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(401);
  });
});
