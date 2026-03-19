import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
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
    const signatureSegment = signer.sign(privateKey, 'base64url');
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
    const signatureSegment = signer.sign(privateKey, 'base64url');
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

  it('rejects a token without exp when requireExp is true', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      requireExp: true,
      secret: 'secret',
    });
    const token = signToken({ sub: 'user-no-exp' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
  });

  it('accepts a token without exp when requireExp is not set', async () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const token = signToken({ sub: 'user-no-exp' }, 'secret');

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'user-no-exp',
    });
  });
});
