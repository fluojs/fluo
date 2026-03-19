import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { JwksClient } from './jwks.js';
import { DefaultJwtVerifier } from './verifier.js';

function createRs256Token(privateKey: string | KeyObject, kid: string): string {
  const headerSegment = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }), 'utf8').toString('base64url');
  const payloadSegment = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60, sub: 'jwks-user' }),
    'utf8',
  ).toString('base64url');
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signer = createSign('sha256');
  signer.update(signingInput);
  const signatureSegment = signer.sign(privateKey, 'base64url');

  return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

describe('JwksClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches keys from jwks uri and finds key by kid', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json');
    const key = await client.getSigningKey('key-1');
    const token = createRs256Token(privateKey, 'key-1');
    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      publicKey: key,
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'jwks-user',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches keys within ttl', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json', 30_000);
    await client.getSigningKey('key-1');
    await client.getSigningKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after ttl expires', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json', 1);
    await client.getSigningKey('key-1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await client.getSigningKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('DefaultJwtVerifier with jwksUri', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('verifies RS256 token using jwksUri option', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const token = createRs256Token(privateKey, 'key-1');

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    ) as typeof fetch;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      jwksUri: 'https://example.test/.well-known/jwks.json',
    });

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'jwks-user',
    });
  });
});
