import { describe, expect, it } from 'vitest';

import { JwtConfigurationError, type DefaultJwtSigner, type DefaultJwtVerifier } from '@konekti/jwt';

import { JwtRefreshTokenAdapter } from './jwt-refresh-token-adapter.js';

function createSigner(): DefaultJwtSigner {
  return {
    signAccessToken: async () => 'access-token',
    signRefreshToken: async () => 'refresh-token',
  } as unknown as DefaultJwtSigner;
}

function createVerifier(): DefaultJwtVerifier {
  return {
    verifyAccessToken: async () => ({ claims: { sub: 'user-1' } }),
    verifyRefreshToken: async () => ({ claims: { family: 'family-1', jti: 'token-1', sub: 'user-1', type: 'refresh' } }),
  } as unknown as DefaultJwtVerifier;
}

describe('JwtRefreshTokenAdapter', () => {
  it('requires an explicit refresh token secret', () => {
    expect(() =>
      new JwtRefreshTokenAdapter(createSigner(), createVerifier(), {
        secret: '',
        store: 'memory',
      }),
    ).toThrow(JwtConfigurationError);
  });

  it('initializes when a refresh token secret is provided', () => {
    expect(() =>
      new JwtRefreshTokenAdapter(createSigner(), createVerifier(), {
        secret: 'refresh-secret',
        store: 'memory',
      }),
    ).not.toThrow();
  });
});
