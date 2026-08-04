import { describe, expect, it } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../src/lib/jwt.js';

describe('JWT', () => {
  it('signs and verifies access tokens', () => {
    const token = signAccessToken({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'CUSTOMER',
    });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.type).toBe('access');
    expect(payload.role).toBe('CUSTOMER');
  });

  it('rejects wrong token type as access', () => {
    const refresh = signRefreshToken({ sub: 'user-1', jti: 'jti-1' });
    expect(() => verifyAccessToken(refresh)).toThrow();
  });

  it('signs and verifies refresh tokens', () => {
    const token = signRefreshToken({ sub: 'user-1', jti: 'jti-1' });
    const payload = verifyRefreshToken(token);
    expect(payload.jti).toBe('jti-1');
    expect(payload.type).toBe('refresh');
  });
});
