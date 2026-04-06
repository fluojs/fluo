import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { JwtExpiredTokenError, JwtInvalidTokenError } from '../errors.js';
import { DefaultJwtVerifier } from './verifier.js';

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signToken(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
  hashAlgorithm = 'sha256',
) {
  const headerSegment = encodeBase64Url(JSON.stringify(header));
  const payloadSegment = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac(hashAlgorithm, secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerSegment}.${payloadSegment}.${signature}`;
}

describe('DefaultJwtVerifier', () => {
  it('verifies a valid token and normalizes the principal', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      audience: 'konekti',
      issuer: 'tests',
      secret: 'secret',
    });
    const token = signToken(
      {
        aud: 'konekti',
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: 'tests',
        scope: 'read write',
        sub: 'user-1',
      },
      'secret',
    );

    await expect(verifier.verifyAccessToken(token)).resolves.toEqual({
      audience: 'konekti',
      claims: expect.objectContaining({ sub: 'user-1' }),
      issuer: 'tests',
      roles: undefined,
      scopes: ['read', 'write'],
      subject: 'user-1',
    });
  });

  it('verifies a valid HS384 token', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS384'],
      issuer: 'tests',
      secret: 'secret',
    });
    const token = signToken(
      {
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: 'tests',
        sub: 'user-hs384',
      },
      'secret',
      { alg: 'HS384', typ: 'JWT' },
      'sha384',
    );

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-hs384',
    });
  });

  it('verifies a valid HS512 token', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS512'],
      issuer: 'tests',
      secret: 'secret',
    });
    const token = signToken(
      {
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: 'tests',
        sub: 'user-hs512',
      },
      'secret',
      { alg: 'HS512', typ: 'JWT' },
      'sha512',
    );

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-hs512',
    });
  });

  it('rejects a token signed with an algorithm not in the allowed list', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const token = signToken(
      {
        exp: Math.floor(Date.now() / 1000) + 60,
        sub: 'user-1',
      },
      'secret',
      { alg: 'HS512', typ: 'JWT' },
      'sha512',
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('rejects expired tokens', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      issuer: 'tests',
      secret: 'secret',
    });
    const token = signToken(
      {
        exp: Math.floor(Date.now() / 1000) - 10,
        iss: 'tests',
        sub: 'user-1',
      },
      'secret',
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtExpiredTokenError);
  });

  it('rejects invalid signatures', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const token = signToken(
      {
        exp: Math.floor(Date.now() / 1000) + 60,
        scopes: ['read'],
        sub: 'user-1',
      },
      'wrong-secret',
    );

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('verifies a valid RS256 token', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { exp, iss: 'tests', sub: 'user-rs256' };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign({ dsaEncoding: 'ieee-p1363', key: privateKey }, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      issuer: 'tests',
      publicKey,
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-rs256',
    });
  });

  it('verifies a valid ES256 token', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = { alg: 'ES256', typ: 'JWT' };
    const payload = { exp, iss: 'tests', sub: 'user-es256' };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign({ dsaEncoding: 'ieee-p1363', key: privateKey }, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['ES256'],
      issuer: 'tests',
      publicKey,
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-es256',
    });
  });

  it('rejects an RS256 token verified with the wrong public key', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { publicKey: wrongPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { exp, sub: 'user-rs256' };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign(privateKey, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      publicKey: wrongPublicKey,
    });

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('verifies a valid RS256 token using a kid-keyed key entry', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = { alg: 'RS256', kid: 'key-1', typ: 'JWT' };
    const payload = { exp, sub: 'user-kid-rs256' };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign(privateKey, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      keys: [{ kid: 'key-1', publicKey }],
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-kid-rs256',
    });
  });

  it('verifies HMAC token without kid when exactly one HMAC key entry is configured', async () => {
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 60, sub: 'single-hmac-key' }, 'secret');
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      keys: [{ kid: 'hmac-1', secret: 'secret' }],
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'single-hmac-key',
    });
  });

  it('rejects HMAC token without kid when multiple HMAC key entries are configured', async () => {
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 60, sub: 'missing-kid-hmac' }, 'secret-1');
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      keys: [
        { kid: 'hmac-1', secret: 'secret-1' },
        { kid: 'hmac-2', secret: 'secret-2' },
      ],
    });

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('rejects token with unknown kid when keys are configured', async () => {
    const token = signToken(
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'unknown-kid' },
      'secret',
      { alg: 'HS256', kid: 'unknown-key', typ: 'JWT' },
    );
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      keys: [{ kid: 'known-key', secret: 'secret' }],
    });

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('verifies RS256 token without kid when exactly one public key entry is configured', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { exp, sub: 'single-rs-key' };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign(privateKey, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      keys: [{ kid: 'rsa-1', publicKey }],
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'single-rs-key',
    });
  });

  it('rejects RS256 token without kid when multiple public key entries are configured', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { publicKey: publicKey1 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { publicKey: publicKey2 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { exp, sub: 'missing-kid-rs' };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign(privateKey, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      keys: [
        { kid: 'rsa-1', publicKey: publicKey1 },
        { kid: 'rsa-2', publicKey: publicKey2 },
      ],
    });

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('rejects a token without exp by default', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const token = signToken({ sub: 'user-no-exp' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('rejects a token without exp when requireExp is true', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      requireExp: true,
      secret: 'secret',
    });
    const token = signToken({ sub: 'user-no-exp' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('accepts a token without exp when requireExp is false', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      requireExp: false,
      secret: 'secret',
    });
    const token = signToken({ sub: 'user-no-exp' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-no-exp',
    });
  });

  it('accepts a token with exp under default requireExp behavior', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 60, sub: 'user-with-exp' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-with-exp',
    });
  });

  it('rejects tokens older than maxAge', async () => {
    const now = Math.floor(Date.now() / 1000);
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      maxAge: 10,
      secret: 'secret',
    });
    const token = signToken({ exp: now + 60, iat: now - 30, sub: 'too-old' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtExpiredTokenError);
  });

  it('rejects tokens without iat when maxAge is configured', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      maxAge: 30,
      secret: 'secret',
    });
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 60, sub: 'missing-iat' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('rejects tokens with non-numeric iat when maxAge is configured', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      maxAge: 30,
      secret: 'secret',
    });
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 60, iat: 'invalid', sub: 'invalid-iat' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('rejects tokens with future iat when maxAge is configured', async () => {
    const now = Math.floor(Date.now() / 1000);
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      maxAge: 30,
      secret: 'secret',
    });
    const token = signToken({ exp: now + 60, iat: now + 20, sub: 'future-iat' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('accepts tokens within maxAge', async () => {
    const now = Math.floor(Date.now() / 1000);
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      maxAge: 30,
      secret: 'secret',
    });
    const token = signToken({ exp: now + 60, iat: now - 10, sub: 'fresh-enough' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'fresh-enough',
    });
  });

  it('calls secretOrKeyProvider with header and verifies token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ exp: now + 60, sub: 'provider-user' }, 'secret', { alg: 'HS256', kid: 'k1', typ: 'JWT' });
    const provider = vi.fn(async (header: { alg: string; kid?: string }) => {
      expect(header.alg).toBe('HS256');
      expect(header.kid).toBe('k1');
      return 'secret';
    });
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secretOrKeyProvider: provider,
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'provider-user',
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('rejects token when secretOrKeyProvider returns wrong key', async () => {
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 60, sub: 'provider-user' }, 'secret');
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secretOrKeyProvider: async () => 'wrong-secret',
    });

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('verifies signature before payload parsing on malformed payload tokens', async () => {
    const headerSegment = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadSegment = encodeBase64Url('not-json-payload');
    const signatureSegment = createHmac('sha256', 'secret').update(`${headerSegment}.${payloadSegment}`).digest('base64url');
    const provider = vi.fn(async () => 'secret');
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secretOrKeyProvider: provider,
    });

    await expect(verifier.verifyAccessToken(`${headerSegment}.${payloadSegment}.${signatureSegment}`)).rejects.toBeInstanceOf(
      JwtInvalidTokenError,
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('verifies RS256 token when secretOrKeyProvider returns public key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const headerSegment = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payloadSegment = encodeBase64Url(JSON.stringify({ exp, sub: 'provider-rs-user' }));
    const signer = createSign('sha256');
    signer.update(`${headerSegment}.${payloadSegment}`);
    const signatureSegment = signer.sign(privateKey, 'base64url');
    const token = `${headerSegment}.${payloadSegment}.${signatureSegment}`;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      secretOrKeyProvider: async () => publicKey,
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'provider-rs-user',
    });
  });
});
