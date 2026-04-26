import { generateKeyPairSync, sign, verify } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { JwtConfigurationError } from '../errors.js';
import { DefaultJwtSigner } from './signer.js';
import { DefaultJwtVerifier } from './verifier.js';

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  const [headerSegment] = token.split('.');
  return JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('DefaultJwtSigner', () => {
  it('fails fast when no signing algorithms are configured', () => {
    expect(() => new DefaultJwtSigner({ algorithms: [], secret: 'secret' })).toThrow(JwtConfigurationError);
    expect(() => new DefaultJwtSigner({ algorithms: [], secret: 'secret' })).toThrow(
      'JWT signer requires at least one allowed JWT algorithm.',
    );
  });

  it('rejects runtime string and prototype-key signing algorithms', () => {
    expect(() => new DefaultJwtSigner({ algorithms: ['none' as never], secret: 'secret' })).toThrow(
      'JWT signer received unsupported JWT algorithm "none".',
    );
    expect(() => new DefaultJwtSigner({ algorithms: ['toString' as never], secret: 'secret' })).toThrow(
      'JWT signer received unsupported JWT algorithm "toString".',
    );
  });

  it('rejects non-positive access token ttl values before issuing a token', async () => {
    const signer = new DefaultJwtSigner({
      accessTokenTtlSeconds: 0,
      algorithms: ['HS256'],
      secret: 'secret',
    });

    await expect(signer.signAccessToken({ sub: 'ttl-user' })).rejects.toThrow(JwtConfigurationError);
    await expect(signer.signAccessToken({ sub: 'ttl-user' })).rejects.toThrow(
      'JWT accessTokenTtlSeconds must be a positive finite number.',
    );
  });

  it('preserves fractional access token ttl seconds in the exp claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T20:00:00.000Z'));

    try {
      const now = Math.floor(Date.now() / 1000);
      const signer = new DefaultJwtSigner({
        accessTokenTtlSeconds: 0.5,
        algorithms: ['HS256'],
        secret: 'secret',
      });
      const token = await signer.signAccessToken({ sub: 'fractional-ttl-user' });
      const [, payloadSegment] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as { exp: number; iat: number };

      expect(payload.iat).toBe(now);
      expect(payload.exp).toBe(now + 0.5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates an access token that the verifier accepts (HS256)', async () => {
    const signer = new DefaultJwtSigner({
      accessTokenTtlSeconds: 120,
      algorithms: ['HS256'],
      audience: 'fluo',
      issuer: 'tests',
      secret: 'secret',
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      audience: 'fluo',
      issuer: 'tests',
      secret: 'secret',
    });
    const token = await signer.signAccessToken({
      scope: 'read write',
      sub: 'signed-user',
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toEqual(
      expect.objectContaining({
        scopes: ['read', 'write'],
        subject: 'signed-user',
      }),
    );
  });

  it('creates an access token that the verifier accepts (HS384)', async () => {
    const signer = new DefaultJwtSigner({
      algorithms: ['HS384'],
      issuer: 'tests',
      secret: 'secret',
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS384'],
      issuer: 'tests',
      secret: 'secret',
    });
    const token = await signer.signAccessToken({ sub: 'user-hs384' });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-hs384',
    });
  });

  it('creates an access token that the verifier accepts (HS512)', async () => {
    const signer = new DefaultJwtSigner({
      algorithms: ['HS512'],
      issuer: 'tests',
      secret: 'secret',
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS512'],
      issuer: 'tests',
      secret: 'secret',
    });
    const token = await signer.signAccessToken({ sub: 'user-hs512' });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-hs512',
    });
  });

  it('uses the first HMAC algorithm when multiple are configured', async () => {
    const signer = new DefaultJwtSigner({
      algorithms: ['HS384', 'HS256'],
      issuer: 'tests',
      secret: 'secret',
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS384'],
      issuer: 'tests',
      secret: 'secret',
    });
    const token = await signer.signAccessToken({ sub: 'user-first-alg' });

    // Token must be signed with HS384 (first in list) — HS384-only verifier must accept it
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-first-alg',
    });
  });

  it('uses the first compatible HMAC key entry when a non-HMAC key appears first', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = new DefaultJwtSigner({
      algorithms: ['HS256'],
      keys: [
        { kid: 'rsa-key', privateKey },
        { kid: 'hmac-key', secret: 'hmac-secret' },
      ],
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      keys: [{ kid: 'hmac-key', secret: 'hmac-secret' }],
    });

    const token = await signer.signAccessToken({ sub: 'user-hmac-key-selection' });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-hmac-key-selection',
    });
    expect(decodeJwtHeader(token)).toMatchObject({ alg: 'HS256', kid: 'hmac-key' });
  });

  it('uses the first compatible asymmetric key entry when an HMAC key appears first', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = new DefaultJwtSigner({
      algorithms: ['RS256', 'HS256'],
      issuer: 'tests',
      keys: [
        { kid: 'hmac-key', secret: 'hmac-secret' },
        { kid: 'rsa-key', privateKey, publicKey },
      ],
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      issuer: 'tests',
      keys: [{ kid: 'rsa-key', publicKey }],
    });

    const token = await signer.signAccessToken({ sub: 'user-rsa-key-selection' });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-rsa-key-selection',
    });
    expect(decodeJwtHeader(token)).toMatchObject({ alg: 'RS256', kid: 'rsa-key' });
  });

  it('sign + verify roundtrip with RS256', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = new DefaultJwtSigner({
      accessTokenTtlSeconds: 120,
      algorithms: ['RS256'],
      audience: 'fluo',
      issuer: 'tests',
      privateKey,
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      audience: 'fluo',
      issuer: 'tests',
      publicKey,
    });
    const token = await signer.signAccessToken({ sub: 'user-rs256', scopes: ['read'] });

    await expect(verifier.verifyAccessToken(token)).resolves.toEqual(
      expect.objectContaining({
        scopes: ['read'],
        subject: 'user-rs256',
      }),
    );
  });

  it('sign + verify roundtrip with ES256', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signer = new DefaultJwtSigner({
      accessTokenTtlSeconds: 120,
      algorithms: ['ES256'],
      audience: 'fluo',
      issuer: 'tests',
      privateKey,
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['ES256'],
      audience: 'fluo',
      issuer: 'tests',
      publicKey,
    });
    const token = await signer.signAccessToken({ sub: 'user-es256', scopes: ['write'] });

    await expect(verifier.verifyAccessToken(token)).resolves.toEqual(
      expect.objectContaining({
        scopes: ['write'],
        subject: 'user-es256',
      }),
    );
  });

  it('verifies ES256 token signed with raw crypto.sign using ieee-p1363', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const now = Math.floor(Date.now() / 1000);
    const headerSegment = encodeBase64Url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
    const payloadSegment = encodeBase64Url(JSON.stringify({ exp: now + 60, iss: 'tests', sub: 'interop-es256' }));
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const signatureSegment = sign('sha256', Buffer.from(signingInput), { dsaEncoding: 'ieee-p1363', key: privateKey }).toString(
      'base64url',
    );
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['ES256'],
      issuer: 'tests',
      publicKey,
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'interop-es256',
    });
  });

  it('creates ES256 token verifiable by raw crypto.verify using ieee-p1363', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signer = new DefaultJwtSigner({
      algorithms: ['ES256'],
      issuer: 'tests',
      privateKey,
    });
    const token = await signer.signAccessToken({ sub: 'interop-es256-signer' });
    const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const signature = Buffer.from(signatureSegment, 'base64url');
    const valid = verify('sha256', Buffer.from(signingInput), { dsaEncoding: 'ieee-p1363', key: publicKey }, signature);

    expect(valid).toBe(true);
  });

  it('uses RFC7518 signature lengths for ES algorithms', async () => {
    const es256 = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const es384 = generateKeyPairSync('ec', { namedCurve: 'P-384' });
    const es512 = generateKeyPairSync('ec', { namedCurve: 'P-521' });

    const signer256 = new DefaultJwtSigner({ algorithms: ['ES256'], privateKey: es256.privateKey });
    const signer384 = new DefaultJwtSigner({ algorithms: ['ES384'], privateKey: es384.privateKey });
    const signer512 = new DefaultJwtSigner({ algorithms: ['ES512'], privateKey: es512.privateKey });

    const token256 = await signer256.signAccessToken({ sub: 'es256-len' });
    const token384 = await signer384.signAccessToken({ sub: 'es384-len' });
    const token512 = await signer512.signAccessToken({ sub: 'es512-len' });

    expect(Buffer.from(token256.split('.')[2], 'base64url')).toHaveLength(64);
    expect(Buffer.from(token384.split('.')[2], 'base64url')).toHaveLength(96);
    expect(Buffer.from(token512.split('.')[2], 'base64url')).toHaveLength(132);
  });

  it('sign + verify roundtrip with RS256 using kid-keyed key entry', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = new DefaultJwtSigner({
      algorithms: ['RS256'],
      issuer: 'tests',
      keys: [{ kid: 'key-1', privateKey, publicKey }],
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      issuer: 'tests',
      keys: [{ kid: 'key-1', publicKey }],
    });
    const token = await signer.signAccessToken({ sub: 'user-kid-rs256' });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-kid-rs256',
    });
  });
});
