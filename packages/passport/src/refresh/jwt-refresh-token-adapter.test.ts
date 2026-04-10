import { describe, expect, it } from 'vitest';

import { DefaultJwtSigner, DefaultJwtVerifier, JwtConfigurationError, type RefreshTokenStore } from '@fluojs/jwt';

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

  it('preserves rotation:false and reuses the same refresh token string', async () => {
    const verifierStore: RefreshTokenStore = {
      async find() {
        return undefined;
      },
      async revoke() {},
      async revokeBySubject() {},
      async save() {},
    };

    const signer = new DefaultJwtSigner({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 3600,
        rotation: false,
        secret: 'refresh-secret',
        store: verifierStore,
      },
      secret: 'access-secret',
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 3600,
        rotation: false,
        secret: 'refresh-secret',
        store: verifierStore,
      },
      secret: 'access-secret',
    });
    const adapter = new JwtRefreshTokenAdapter(signer, verifier, {
      rotation: false,
      secret: 'refresh-secret',
      store: 'memory',
    });

    const issued = await adapter.issueRefreshToken('user-1');
    const rotated = await adapter.rotateRefreshToken(issued);

    expect(rotated.accessToken).toContain('.');
    expect(rotated.refreshToken).toBe(issued);
  });
});
