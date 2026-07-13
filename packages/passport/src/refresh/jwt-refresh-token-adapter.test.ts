import {
  DefaultJwtSigner,
  DefaultJwtVerifier,
  JwtConfigurationError,
  JwtInvalidTokenError,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@fluojs/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

function createInMemoryStore(): RefreshTokenStore {
  const adapter = new JwtRefreshTokenAdapter(createSigner(), createVerifier(), {
    secret: 'refresh-secret',
    store: 'memory',
  });

  return adapter['service']['options'].store;
}

function createRecord(id: string, expiresAt: Date): RefreshTokenRecord {
  return {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt,
    family: `family-${id}`,
    id,
    subject: 'user-1',
    used: false,
  };
}

describe('JwtRefreshTokenAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function createRotationCapableStore(): RefreshTokenStore {
    return {
      async consume() {
        return 'invalid';
      },
      async find() {
        return undefined;
      },
      async revoke() {},
      async revokeBySubject() {},
      async save() {},
    };
  }

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

  it('evicts expired records before saving a new in-memory token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createInMemoryStore();
    await store.save(createRecord('expired', new Date('2026-01-01T00:00:01.000Z')));

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    await store.save(createRecord('active', new Date('2026-01-01T00:00:02.000Z')));

    await expect(store.find('expired')).resolves.toBeUndefined();
    await expect(store.find('active')).resolves.toMatchObject({ id: 'active' });
  });

  it('evicts an expired record after returning it from an in-memory lookup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createInMemoryStore();
    await store.save(createRecord('expired', new Date('2026-01-01T00:00:01.000Z')));

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));

    await expect(store.find('expired')).resolves.toMatchObject({ id: 'expired' });
    await expect(store.find('expired')).resolves.toBeUndefined();
  });

  it('evicts expired records when the in-memory store consumes a token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createInMemoryStore();
    await store.save(createRecord('consumed', new Date('2026-01-01T00:00:01.000Z')));
    await store.save(createRecord('unrelated', new Date('2026-01-01T00:00:01.000Z')));

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    await expect(store.consume?.({
      family: 'family-consumed',
      now: new Date(),
      subject: 'user-1',
      tokenId: 'consumed',
    })).resolves.toBe('expired');

    await expect(store.find('consumed')).resolves.toBeUndefined();
    await expect(store.find('unrelated')).resolves.toBeUndefined();
  });

  it('evicts expired records during an in-memory revocation operation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const store = createInMemoryStore();
    await store.save(createRecord('expired', new Date('2026-01-01T00:00:01.000Z')));

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    await store.revoke('missing');

    await expect(store.find('expired')).resolves.toBeUndefined();
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

  it('keeps an independent token family rotatable after detecting reuse in the in-memory store', async () => {
    const store = createRotationCapableStore();
    const signer = new DefaultJwtSigner({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      secret: 'access-secret',
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 3600,
        rotation: true,
        secret: 'refresh-secret',
        store,
      },
      secret: 'access-secret',
    });
    const adapter = new JwtRefreshTokenAdapter(signer, verifier, {
      secret: 'refresh-secret',
      store: 'memory',
    });

    const compromisedFamilyToken = await adapter.issueRefreshToken('user-1');
    const independentFamilyToken = await adapter.issueRefreshToken('user-1');
    const firstRotation = await adapter.rotateRefreshToken(compromisedFamilyToken);

    expect(firstRotation.refreshToken).not.toBe(compromisedFamilyToken);
    await expect(adapter.rotateRefreshToken(compromisedFamilyToken)).rejects.toThrow(JwtInvalidTokenError);

    const independentRotation = await adapter.rotateRefreshToken(independentFamilyToken);
    expect(independentRotation.refreshToken).not.toBe(independentFamilyToken);
  });
});
