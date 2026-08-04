import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('password hashing (argon2id)', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('Password123!');
    expect(hash).not.toContain('Password123!');
    expect(await verifyPassword(hash, 'Password123!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
