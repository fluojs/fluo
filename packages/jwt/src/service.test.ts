import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signing/signer.js';
import { JwtConfigurationError, JwtInvalidTokenError } from './errors.js';
import type { JwtVerifierOptions } from './types.js';
import { DefaultJwtVerifier } from './signing/verifier.js';

function createRs256Token(privateKey: string | KeyObject, kid: string, issuer = 'jwt-service-tests'): string {
  const headerSegment = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }), 'utf8').toString('base64url');
  const payloadSegment = Buffer.from(
    JSON.stringify({ aud: 'fluo-users', exp: Math.floor(Date.now() / 1000) + 60, iss: issuer, sub: 'jwks-user' }),
    'utf8',
  ).toString('base64url');
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signer = createSign('sha256');
  signer.update(signingInput);
  const signatureSegment = signer.sign(privateKey, 'base64url');

  return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

function createHs256Token(secret: string, payload: Record<string, unknown>): string {
  const headerSegment = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url');
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureSegment = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

function createJwtService(options: JwtVerifierOptions): JwtService {
  return new JwtService(options, new DefaultJwtSigner(options), new DefaultJwtVerifier(options));
}

async function expectVerifyOverrideParity(
  options: JwtVerifierOptions,
  token: string,
  overrides: Parameters<JwtService['verify']>[1],
): Promise<void> {
  const service = createJwtService(options);
  const mergedOptions: JwtVerifierOptions = {
    ...options,
    algorithms: overrides?.algorithms ?? options.algorithms,
    audience: overrides?.audience ?? options.audience,
    clockSkewSeconds: overrides?.clockSkewSeconds ?? options.clockSkewSeconds,
    issuer: overrides?.issuer ?? options.issuer,
    maxAge: overrides?.maxAge ?? options.maxAge,
    requireExp: overrides?.requireExp ?? options.requireExp,
  };

  try {
    const mergedVerifier = new DefaultJwtVerifier(mergedOptions);
    const [serviceClaims, verifierPrincipal] = await Promise.all([
      service.verify<Record<string, unknown>>(token, overrides),
      mergedVerifier.verifyAccessToken(token),
    ]);

    expect(serviceClaims).toEqual(verifierPrincipal.claims);
  } catch (error) {
    await expect(service.verify(token, overrides)).rejects.toThrow((error as Error).message);

    try {
      const mergedVerifier = new DefaultJwtVerifier(mergedOptions);
      await expect(mergedVerifier.verifyAccessToken(token)).rejects.toThrow((error as Error).message);
    } catch (verifierError) {
      expect((verifierError as Error).message).toBe((error as Error).message);
    }
  }
}

describe('JwtService', () => {
  it('signs and verifies payload claims with NestJS-style facade methods', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const token = await service.sign({ role: 'admin', sub: 'service-user' });

    await expect(service.verify<{ role?: string; sub?: string }>(token)).resolves.toMatchObject({
      role: 'admin',
      sub: 'service-user',
    });
  });

  it('applies sign and verify options overrides', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const token = await service.sign(
      {
        role: 'reader',
      },
      {
        audience: 'fluo-users',
        expiresIn: '60s',
        issuer: 'jwt-service-tests',
        subject: 'service-overrides-user',
      },
    );

    await expect(
      service.verify<{ aud?: string; role?: string; sub?: string }>(token, {
        audience: 'fluo-users',
        issuer: 'jwt-service-tests',
      }),
    ).resolves.toMatchObject({
      aud: 'fluo-users',
      role: 'reader',
      sub: 'service-overrides-user',
    });
  });

  it('prefers per-call expiresIn over a pre-existing payload exp claim', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await service.sign(
      {
        exp: now + 3600,
        role: 'reader',
        sub: 'service-overrides-user',
      },
      {
        expiresIn: 60,
      },
    );

    const decoded = service.decode(token);

    expect(decoded).toMatchObject({
      exp: expect.any(Number),
      role: 'reader',
      sub: 'service-overrides-user',
    });

    expect((decoded as { exp: number }).exp).toBeLessThanOrEqual(now + 60);
    expect((decoded as { exp: number }).exp).toBeGreaterThanOrEqual(now + 59);
  });

  it('decodes payload without signature verification', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const token = await service.sign({ sub: 'decoded-user' });

    expect(service.decode(token)).toMatchObject({ sub: 'decoded-user' });
    expect(service.decode('invalid-token')).toBeNull();
  });

  it('reuses the shared jwks cache when verify options override claim policy', async () => {
    const originalFetch = globalThis.fetch;
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const service = createJwtService({
        algorithms: ['RS256'],
        jwksCacheTtl: 30_000,
        jwksUri: 'https://example.test/.well-known/jwks.json',
      });
      const token = createRs256Token(privateKey, 'key-1');

      await expect(service.verify<{ sub?: string }>(token, { audience: 'fluo-users', issuer: 'jwt-service-tests' })).resolves.toMatchObject({
        sub: 'jwks-user',
      });
      await expect(service.verify<{ sub?: string }>(token, { audience: 'fluo-users', issuer: 'jwt-service-tests' })).resolves.toMatchObject({
        sub: 'jwks-user',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  it('matches merged verifier semantics for supported verify overrides', async () => {
    const baseOptions: JwtVerifierOptions = {
      algorithms: ['HS256'],
      clockSkewSeconds: 5,
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    };
    const service = createJwtService(baseOptions);
    const token = await service.sign(
      {
        aud: 'fluo-users',
        iat: Math.floor(Date.now() / 1000) - 10,
        role: 'reader',
      },
      {
        expiresIn: 60,
        issuer: 'jwt-service-tests',
        subject: 'service-overrides-user',
      },
    );

    await expectVerifyOverrideParity(baseOptions, token, {
      audience: 'fluo-users',
      issuer: 'jwt-service-tests',
    });
    await expectVerifyOverrideParity(baseOptions, token, {
      audience: 'fluo-users',
      clockSkewSeconds: 0,
      issuer: 'jwt-service-tests',
      maxAge: 30,
    });
    await expectVerifyOverrideParity(baseOptions, token, {
      audience: 'fluo-users',
      issuer: 'wrong-issuer',
    });
  });

  it('supports requireExp override parity without changing key-resolution behavior', async () => {
    const options: JwtVerifierOptions = {
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    };
    const token = createHs256Token(options.secret!, {
      iss: 'jwt-service-tests',
      iat: Math.floor(Date.now() / 1000),
      sub: 'no-exp-user',
    });

    await expect(createJwtService(options).verify(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
    await expectVerifyOverrideParity(options, token, {
      issuer: 'jwt-service-tests',
      requireExp: false,
    });
  });

  it('fails fast for an empty algorithms override with verifier reconstruction parity', async () => {
    const options: JwtVerifierOptions = {
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    };
    const token = createHs256Token(options.secret!, {
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: 'jwt-service-tests',
      sub: 'empty-algorithms-user',
    });

    await expect(createJwtService(options).verify(token, { algorithms: [] })).rejects.toBeInstanceOf(JwtConfigurationError);
    await expectVerifyOverrideParity(options, token, { algorithms: [] });
  });

  it('fails fast for unsupported algorithms override values with verifier reconstruction parity', async () => {
    const options: JwtVerifierOptions = {
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    };
    const token = createHs256Token(options.secret!, {
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: 'jwt-service-tests',
      sub: 'unsupported-algorithms-user',
    });

    await expect(
      createJwtService(options).verify(token, { algorithms: ['HS999' as never] }),
    ).rejects.toBeInstanceOf(JwtConfigurationError);
    await expectVerifyOverrideParity(options, token, { algorithms: ['HS999' as never] });
  });
});
