import { describe, expect, it } from 'vitest';
import { registerSchema, createProductSchema, loginSchema } from '@orderflow/shared';

describe('zod schemas', () => {
  it('validates registration', () => {
    const ok = registerSchema.safeParse({
      email: 'User@Example.com',
      password: 'Password123!',
      firstName: 'A',
      lastName: 'B',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.email).toBe('user@example.com');
    }
  });

  it('rejects weak passwords', () => {
    const bad = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'short',
      firstName: 'A',
      lastName: 'B',
    });
    expect(bad.success).toBe(false);
  });

  it('requires positive product price in cents', () => {
    expect(
      createProductSchema.safeParse({
        sku: 'X',
        name: 'Y',
        priceCents: 0,
      }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({
        sku: 'SKU1',
        name: 'Y',
        priceCents: 100,
      }).success,
    ).toBe(true);
  });

  it('validates login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });
});
