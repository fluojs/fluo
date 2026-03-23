import { describe, expect, it, vi } from 'vitest';

import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import { RefreshTokenService, type RefreshTokenRecord, type RefreshTokenStore } from './refresh-token.js';
import { DefaultJwtSigner } from './signer.js';
import { DefaultJwtVerifier } from './verifier.js';

class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly records = new Map<string, RefreshTokenRecord>();

  async save(token: RefreshTokenRecord): Promise<void> {
    this.records.set(token.id, token);
  }

  async find(tokenId: string): Promise<RefreshTokenRecord | undefined> {
    return this.records.get(tokenId);
  }

  async revoke(tokenId: string): Promise<void> {
    this.records.delete(tokenId);
  }

  async revokeBySubject(subject: string): Promise<void> {
    for (const [id, record] of this.records.entries()) {
      if (record.subject === subject) {
        this.records.delete(id);
      }
    }
  }

  async consume(input: { tokenId: string; subject: string; family: string; now: Date }): Promise<'consumed' | 'already_used' | 'expired' | 'not_found' | 'mismatch'> {
    const record = this.records.get(input.tokenId);

    if (!record) {
      return 'not_found';
    }

    if (record.subject !== input.subject || record.family !== input.family) {
      return 'mismatch';
    }

    if (record.expiresAt.getTime() <= input.now.getTime()) {
      return 'expired';
    }

    if (record.used) {
      return 'already_used';
    }

    this.records.set(input.tokenId, {
      ...record,
      used: true,
    });

    return 'consumed';
  }

  countBySubject(subject: string): number {
    let count = 0;

    for (const record of this.records.values()) {
      if (record.subject === subject) {
        count += 1;
      }
    }

    return count;
  }

  markExpired(tokenId: string): void {
    const record = this.records.get(tokenId);

    if (!record) {
      return;
    }

    this.records.set(tokenId, {
      ...record,
      expiresAt: new Date(Date.now() - 1_000),
    });
  }
}

function readTokenPayload(token: string): Record<string, unknown> {
  const [, payloadSegment] = token.split('.');
  return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function createService(
  store: RefreshTokenStore,
  options: {
    accessMaxAgeSeconds?: number;
    expiresInSeconds?: number;
    refreshSecret?: string;
    refreshVerifyMaxAgeSeconds?: number;
    rotation?: boolean;
  } = {},
): { service: RefreshTokenService; verifier: DefaultJwtVerifier } {
  const refreshOptions = {
    expiresInSeconds: options.expiresInSeconds ?? 3600,
    rotation: options.rotation ?? true,
    secret: options.refreshSecret ?? 'refresh-secret',
    verifyMaxAgeSeconds: options.refreshVerifyMaxAgeSeconds,
    store,
  };

  const signer = new DefaultJwtSigner({
    algorithms: ['HS256'],
    refreshToken: refreshOptions,
    secret: 'access-secret',
  });
  const verifier = new DefaultJwtVerifier({
    algorithms: ['HS256'],
    maxAge: options.accessMaxAgeSeconds,
    refreshToken: refreshOptions,
    secret: 'access-secret',
  });

  return {
    service: new RefreshTokenService(refreshOptions, signer, verifier),
    verifier,
  };
}

describe('RefreshTokenService', () => {
  it('issues a refresh token with expected claims', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service } = createService(store);

    const refreshToken = await service.issueRefreshToken('user-1');
    const payload = readTokenPayload(refreshToken);

    expect(payload.sub).toBe('user-1');
    expect(payload.type).toBe('refresh');
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.family).toBe('string');
  });

  it('rotates refresh token and marks previous token as used', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service } = createService(store);
    const firstToken = await service.issueRefreshToken('user-1');
    const firstPayload = readTokenPayload(firstToken);
    const firstRecord = await store.find(firstPayload.jti as string);

    expect(firstRecord?.used).toBe(false);

    const rotated = await service.rotateRefreshToken(firstToken);
    const newPayload = readTokenPayload(rotated.refreshToken);
    const updatedFirstRecord = await store.find(firstPayload.jti as string);
    const newRecord = await store.find(newPayload.jti as string);

    expect(rotated.accessToken).toContain('.');
    expect(updatedFirstRecord?.used).toBe(true);
    expect(newRecord?.used).toBe(false);
    expect(newPayload.family).toBe(firstPayload.family);
  });

  it('detects refresh token reuse and revokes all tokens for the subject', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service } = createService(store);
    const token = await service.issueRefreshToken('user-1');

    await service.rotateRefreshToken(token);
    await expect(service.rotateRefreshToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
    expect(store.countBySubject('user-1')).toBe(0);
  });

  it('revokeAllForSubject removes all subject tokens', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service } = createService(store);

    await service.issueRefreshToken('user-1');
    await service.issueRefreshToken('user-1');
    expect(store.countBySubject('user-1')).toBe(2);

    await service.revokeAllForSubject('user-1');
    expect(store.countBySubject('user-1')).toBe(0);
  });

  it('rejects expired refresh token records', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service } = createService(store);
    const token = await service.issueRefreshToken('user-1');
    const payload = readTokenPayload(token);

    store.markExpired(payload.jti as string);

    await expect(service.rotateRefreshToken(token)).rejects.toBeInstanceOf(JwtExpiredTokenError);
  });

  it('uses refreshToken.secret to sign and verify refresh tokens', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service, verifier } = createService(store, { refreshSecret: 'refresh-secret' });
    const token = await service.issueRefreshToken('user-1');

    await expect(verifier.verifyRefreshToken(token)).resolves.toMatchObject({ subject: 'user-1' });
    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('does not apply access maxAge to refresh verification by default', async () => {
    vi.useFakeTimers();

    try {
      const store = new InMemoryRefreshTokenStore();
      const { service, verifier } = createService(store, { accessMaxAgeSeconds: 1 });
      const token = await service.issueRefreshToken('user-1');

      vi.advanceTimersByTime(5_000);

      await expect(verifier.verifyRefreshToken(token)).resolves.toMatchObject({ subject: 'user-1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies refresh verifyMaxAgeSeconds independently from access maxAge', async () => {
    vi.useFakeTimers();

    try {
      const store = new InMemoryRefreshTokenStore();
      const { service, verifier } = createService(store, {
        accessMaxAgeSeconds: 600,
        refreshVerifyMaxAgeSeconds: 1,
      });
      const token = await service.issueRefreshToken('user-1');

      vi.advanceTimersByTime(5_000);

      await expect(verifier.verifyRefreshToken(token)).rejects.toBeInstanceOf(JwtExpiredTokenError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows only one successful rotation under concurrent requests', async () => {
    const store = new InMemoryRefreshTokenStore();
    const { service } = createService(store);
    const token = await service.issueRefreshToken('user-1');

    const [first, second] = await Promise.allSettled([
      service.rotateRefreshToken(token),
      service.rotateRefreshToken(token),
    ]);

    const fulfilled = [first, second].filter((result): result is PromiseFulfilledResult<{ accessToken: string; refreshToken: string }> => result.status === 'fulfilled');
    const rejected = [first, second].filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(JwtInvalidTokenError);
  });

  it('fails fast when rotation is enabled with a legacy store lacking consume()', () => {
    const legacyStore: RefreshTokenStore = {
      async save(_token: RefreshTokenRecord): Promise<void> {},
      async find(_tokenId: string): Promise<RefreshTokenRecord | undefined> {
        return undefined;
      },
      async revoke(_tokenId: string): Promise<void> {},
      async revokeBySubject(_subject: string): Promise<void> {},
    };
    const refreshOptions = {
      expiresInSeconds: 3600,
      rotation: true,
      secret: 'refresh-secret',
      store: legacyStore,
    };
    expect(
      () =>
        new DefaultJwtVerifier({
          algorithms: ['HS256'],
          refreshToken: refreshOptions,
          secret: 'access-secret',
        }),
    ).toThrow(JwtConfigurationError);
  });

  it('fails fast when refresh secret is empty', () => {
    const store = new InMemoryRefreshTokenStore();
    const refreshOptions = {
      expiresInSeconds: 3600,
      rotation: false,
      secret: '',
      store,
    };
    expect(
      () =>
        new DefaultJwtVerifier({
          algorithms: ['HS256'],
          refreshToken: refreshOptions,
          secret: 'access-secret',
        }),
    ).toThrow(JwtConfigurationError);
  });

  it('fails fast when refresh expiresInSeconds is non-positive', () => {
    const store = new InMemoryRefreshTokenStore();
    const refreshOptions = {
      expiresInSeconds: 0,
      rotation: false,
      secret: 'refresh-secret',
      store,
    };
    expect(
      () =>
        new DefaultJwtVerifier({
          algorithms: ['HS256'],
          refreshToken: refreshOptions,
          secret: 'access-secret',
        }),
    ).toThrow(JwtConfigurationError);
  });

  it('fails fast when refresh verifyMaxAgeSeconds is negative', () => {
    const store = new InMemoryRefreshTokenStore();
    const refreshOptions = {
      expiresInSeconds: 3600,
      rotation: false,
      secret: 'refresh-secret',
      store,
      verifyMaxAgeSeconds: -1,
    };

    expect(
      () =>
        new DefaultJwtVerifier({
          algorithms: ['HS256'],
          refreshToken: refreshOptions,
          secret: 'access-secret',
        }),
    ).toThrow(JwtConfigurationError);
  });
});
