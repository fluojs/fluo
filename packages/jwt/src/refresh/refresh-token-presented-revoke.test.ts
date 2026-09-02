import { describe, expect, it } from 'vitest';

import { JwtInvalidTokenError } from '../errors.js';
import { DefaultJwtSigner } from '../signing/signer.js';
import { DefaultJwtVerifier } from '../signing/verifier.js';
import {
  type RefreshTokenRecord,
  RefreshTokenService,
  type RefreshTokenStore,
} from './refresh-token.js';

class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly records = new Map<string, RefreshTokenRecord>();

  get size(): number {
    return this.records.size;
  }

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
    for (const [tokenId, record] of this.records) {
      if (record.subject === subject) {
        this.records.delete(tokenId);
      }
    }
  }
}

function createService(store: RefreshTokenStore): RefreshTokenService {
  const refreshToken = {
    expiresInSeconds: 3600,
    rotation: false,
    secret: 'refresh-secret',
    store,
  };
  const signer = new DefaultJwtSigner({
    algorithms: ['HS256'],
    refreshToken,
    secret: 'access-secret',
  });
  const verifier = new DefaultJwtVerifier({
    algorithms: ['HS256'],
    refreshToken,
    secret: 'access-secret',
  });

  return new RefreshTokenService(refreshToken, signer, verifier);
}

describe('RefreshTokenService presented refresh-token revocation', () => {
  it('revokes a record for a verified presented refresh token', async () => {
    // Given
    const store = new InMemoryRefreshTokenStore();
    const service = createService(store);
    const token = await service.issueRefreshToken('user-1');

    // When
    await expect(service.revokePresentedRefreshToken(token)).resolves.toBeUndefined();

    // Then
    expect(store.size).toBe(0);
  });

  it('does not revoke a record for a tampered presented refresh token', async () => {
    // Given
    const store = new InMemoryRefreshTokenStore();
    const service = createService(store);
    const token = await service.issueRefreshToken('user-1');

    // When
    await expect(service.revokePresentedRefreshToken(`${token}tampered`)).rejects.toBeInstanceOf(JwtInvalidTokenError);

    // Then
    expect(store.size).toBe(1);
  });
});
