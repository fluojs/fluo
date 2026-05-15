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
    vi.useRealTimers();
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

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
    vi.setSystemTime(new Date('2026-01-01T00:00:00.002Z'));
    await client.getSigningKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds the JWKS cache and evicts the oldest retained key', async () => {
    const { publicKey: publicKey1 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { publicKey: publicKey2 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { publicKey: publicKey3 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk1 = publicKey1.export({ format: 'jwk' });
    const jwk2 = publicKey2.export({ format: 'jwk' });
    const jwk3 = publicKey3.export({ format: 'jwk' });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          keys: [
            { ...jwk1, kid: 'key-1' },
            { ...jwk2, kid: 'key-2' },
            { ...jwk3, kid: 'key-3' },
          ],
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json', 30_000, 5_000, 2);
    await client.getSigningKey('key-1');
    await client.getSigningKey('key-2');
    await client.getSigningKey('key-3');
    await client.getSigningKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('clears retained JWKS keys when disposed', async () => {
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
    client.dispose();
    await client.getSigningKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prevents in-flight JWKS fetches from repopulating cache after dispose', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    let resolveFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json', 30_000);
    const pendingKey = client.getSigningKey('key-1');

    client.dispose();
    resolveFetch(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );

    await expect(pendingKey).rejects.toThrow('JWKS client was disposed while fetching keys.');

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    ) as typeof fetch;

    await client.getSigningKey('key-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid JWKS lifecycle budgets during client construction', () => {
    expect(() => new JwksClient('https://example.test/.well-known/jwks.json', Number.NaN)).toThrow(
      'JWKS cache ttl must be a non-negative finite number.',
    );
    expect(() => new JwksClient('https://example.test/.well-known/jwks.json', 30_000, 0)).toThrow(
      'JWKS request timeout must be a positive finite number.',
    );
    expect(() => new JwksClient('https://example.test/.well-known/jwks.json', 30_000, 5_000, 1.5)).toThrow(
      'JWKS cache max entries must be a positive integer.',
    );
  });

  it('fails fast when the jwks fetch exceeds the configured timeout budget', async () => {
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
          },
          { once: true },
        );
      });
    }) as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json', 30_000, 5);

    await expect(client.getSigningKey('key-1')).rejects.toThrow('JWKS fetch timed out after 5ms.');
  });

  it('rejects unknown JWKS kids with the JWT invalid-token error code', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'known-key' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    ) as typeof fetch;

    const client = new JwksClient('https://example.test/.well-known/jwks.json');

    await expect(client.getSigningKey('unknown-key')).rejects.toMatchObject({ code: 'JWT_INVALID_TOKEN' });
  });
});

describe('DefaultJwtVerifier with jwksUri', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('passes the jwks request timeout through verifier options', async () => {
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
          },
          { once: true },
        );
      });
    }) as typeof fetch;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      jwksRequestTimeoutMs: 5,
      jwksUri: 'https://example.test/.well-known/jwks.json',
    });

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = createRs256Token(privateKey, 'key-1');

    await expect(verifier.verifyAccessToken(token)).rejects.toThrow('JWKS fetch timed out after 5ms.');
  });

  it('passes the jwks cache max entries through verifier options', async () => {
    const { privateKey: privateKey1, publicKey: publicKey1 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { privateKey: privateKey2, publicKey: publicKey2 } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk1 = publicKey1.export({ format: 'jwk' });
    const jwk2 = publicKey2.export({ format: 'jwk' });
    const token1 = createRs256Token(privateKey1, 'key-1');
    const token2 = createRs256Token(privateKey2, 'key-2');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          keys: [
            { ...jwk1, kid: 'key-1' },
            { ...jwk2, kid: 'key-2' },
          ],
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      jwksCacheMaxEntries: 1,
      jwksUri: 'https://example.test/.well-known/jwks.json',
    });
    await verifier.verifyAccessToken(token1);
    await verifier.verifyAccessToken(token2);
    await verifier.verifyAccessToken(token1);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('disposes verifier-owned jwks cache entries', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const token = createRs256Token(privateKey, 'key-1');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const verifier = new DefaultJwtVerifier({
      algorithms: ['RS256'],
      jwksUri: 'https://example.test/.well-known/jwks.json',
    });
    await verifier.verifyAccessToken(token);
    verifier.dispose();
    await verifier.verifyAccessToken(token);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
