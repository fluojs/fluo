import { describe, expect, it } from 'vitest';

import { Module, type Constructor, type Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { FluoFactory } from '@fluojs/runtime';

import { JwtModule } from './module.js';
import { type RefreshTokenRecord, type RefreshTokenStore, RefreshTokenService } from './refresh/refresh-token.js';

class NoopRefreshTokenStore implements RefreshTokenStore {
  async save(_: RefreshTokenRecord): Promise<void> {}

  async find(_: string): Promise<RefreshTokenRecord | undefined> {
    return undefined;
  }

  async revoke(_: string): Promise<void> {}

  async revokeBySubject(_: string): Promise<void> {}

  async consume(): Promise<'consumed' | 'already_used' | 'expired' | 'not_found' | 'mismatch'> {
    return 'not_found';
  }
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && 'provide' in value);
}

function isToken(value: unknown): value is Token {
  return typeof value === 'function' || typeof value === 'string' || typeof value === 'symbol';
}

function moduleProviders(moduleType: Constructor): Provider[] {
  const providers = getModuleMetadata(moduleType)?.providers;

  if (!Array.isArray(providers) || !providers.every(isProvider)) {
    throw new Error('JwtModule did not register providers metadata.');
  }

  return providers;
}

function moduleExports(moduleType: Constructor): Token[] {
  const exports = getModuleMetadata(moduleType)?.exports;

  return Array.isArray(exports) && exports.every(isToken) ? exports : [];
}

async function createJwtApplicationContext(jwtModule: Constructor) {
  @Module({ imports: [jwtModule] })
  class AppModule {}

  return FluoFactory.createApplicationContext(AppModule);
}

describe('JwtModule refresh token configuration', () => {
  it('registers refresh token service for async options when refreshToken is configured', async () => {
    const app = await createJwtApplicationContext(JwtModule.forRootAsync({
      useFactory: async () => ({
        algorithms: ['HS256'],
        refreshToken: {
          expiresInSeconds: 60,
          rotation: true,
          secret: 'refresh-secret',
          store: new NoopRefreshTokenStore(),
        },
        secret: 'jwt-secret',
      }),
    }));

    try {
      expect(app.container.has(RefreshTokenService)).toBe(true);
      await expect(app.container.resolve(RefreshTokenService)).resolves.toBeInstanceOf(RefreshTokenService);
    } finally {
      await app.close();
    }
  });

  it('fails async bootstrap when refreshToken is configured without any HMAC algorithms', async () => {
    await expect(createJwtApplicationContext(JwtModule.forRootAsync({
      useFactory: async () => ({
        algorithms: ['RS256'],
        publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApseudo\n-----END PUBLIC KEY-----',
        refreshToken: {
          expiresInSeconds: 60,
          rotation: false,
          secret: 'refresh-secret',
          store: new NoopRefreshTokenStore(),
        },
      }),
    }))).rejects.toThrow(
      'JWT refresh token verifier requires at least one HMAC algorithm (HS256/HS384/HS512) in the allowed algorithms list.',
    );
  });

  it('registers refresh token service when refresh options are provided', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 60,
        rotation: true,
        secret: 'refresh-secret',
        store: new NoopRefreshTokenStore(),
      },
      secret: 'jwt-secret',
    });

    container.register(...moduleProviders(moduleType));
    await expect(container.resolve(RefreshTokenService)).resolves.toBeInstanceOf(RefreshTokenService);
  });

  it('exports refresh token service from synchronous registration when refresh options are provided', () => {
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 60,
        rotation: true,
        secret: 'refresh-secret',
        store: new NoopRefreshTokenStore(),
      },
      secret: 'jwt-secret',
    });

    expect(moduleExports(moduleType)).toContain(RefreshTokenService);
  });
});
