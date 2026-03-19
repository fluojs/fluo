import { describe, expect, it } from 'vitest';

import { JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
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

describe('RefreshTokenService', () => {
  it('issues a refresh token with expected claims', async () => {
    const store = new InMemoryRefreshTokenStore();
    const signer = new DefaultJwtSigner({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const service = new RefreshTokenService(
      {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      signer,
      verifier,
    );

    const refreshToken = await service.issueRefreshToken('user-1');
    const payload = readTokenPayload(refreshToken);

    expect(payload.sub).toBe('user-1');
    expect(payload.type).toBe('refresh');
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.family).toBe('string');
  });

  it('rotates refresh token and marks previous token as used', async () => {
    const store = new InMemoryRefreshTokenStore();
    const signer = new DefaultJwtSigner({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const service = new RefreshTokenService(
      {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      signer,
      verifier,
    );
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
    const signer = new DefaultJwtSigner({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const service = new RefreshTokenService(
      {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      signer,
      verifier,
    );
    const token = await service.issueRefreshToken('user-1');

    await service.rotateRefreshToken(token);
    await expect(service.rotateRefreshToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
    expect(store.countBySubject('user-1')).toBe(0);
  });

  it('revokeAllForSubject removes all subject tokens', async () => {
    const store = new InMemoryRefreshTokenStore();
    const signer = new DefaultJwtSigner({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const service = new RefreshTokenService(
      {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      signer,
      verifier,
    );

    await service.issueRefreshToken('user-1');
    await service.issueRefreshToken('user-1');
    expect(store.countBySubject('user-1')).toBe(2);

    await service.revokeAllForSubject('user-1');
    expect(store.countBySubject('user-1')).toBe(0);
  });

  it('rejects expired refresh token records', async () => {
    const store = new InMemoryRefreshTokenStore();
    const signer = new DefaultJwtSigner({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const verifier = new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'refresh-secret' });
    const service = new RefreshTokenService(
      {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      signer,
      verifier,
    );
    const token = await service.issueRefreshToken('user-1');
    const payload = readTokenPayload(token);

    store.markExpired(payload.jti as string);

    await expect(service.rotateRefreshToken(token)).rejects.toBeInstanceOf(JwtExpiredTokenError);
  });
});
