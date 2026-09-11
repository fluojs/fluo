import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signing/signer.js';
import { DefaultJwtVerifier } from './signing/verifier.js';
import type { JwtClaims, JwtVerifierOptions } from './types.js';

function createJwtService(options: JwtVerifierOptions): JwtService {
  return new JwtService(options, new DefaultJwtSigner(options), new DefaultJwtVerifier(options));
}

async function signAccessToken(options: JwtVerifierOptions, claims: JwtClaims): Promise<string> {
  return new DefaultJwtSigner(options).signAccessToken(claims);
}

function signTokenWithoutExpiration(secret: string, claims: JwtClaims): string {
  const headerSegment = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url');
  const payloadSegment = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureSegment = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signatureSegment}`;
}

describe('JwtService verification policy overrides', () => {
  it('uses an algorithms override to reject the default policy and accept the supplied policy', async () => {
    const secret = 'policy-secret';
    const service = createJwtService({ algorithms: ['HS256'], secret });
    const token = await signAccessToken(
      { algorithms: ['HS384'], secret },
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'algorithm-policy-user' },
    );

    await expect(service.verify(token)).rejects.toThrow('JWT algorithm is not allowed.');
    await expect(service.verify(token, { algorithms: ['HS384'] })).resolves.toMatchObject({
      subject: 'algorithm-policy-user',
    });
  });

  it('uses an issuer override to reject the default policy and accept the supplied policy', async () => {
    const secret = 'policy-secret';
    const service = createJwtService({ algorithms: ['HS256'], issuer: 'default-issuer', secret });
    const token = await signAccessToken(
      { algorithms: ['HS256'], issuer: 'requested-issuer', secret },
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'issuer-policy-user' },
    );

    await expect(service.verify(token)).rejects.toThrow('JWT issuer does not match.');
    await expect(service.verify(token, { issuer: 'requested-issuer' })).resolves.toMatchObject({
      subject: 'issuer-policy-user',
    });
  });

  it('uses an audience override to reject the default policy and accept the supplied policy', async () => {
    const secret = 'policy-secret';
    const service = createJwtService({ algorithms: ['HS256'], audience: 'default-audience', secret });
    const token = await signAccessToken(
      { algorithms: ['HS256'], audience: 'requested-audience', secret },
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'audience-policy-user' },
    );

    await expect(service.verify(token)).rejects.toThrow('JWT audience does not match.');
    await expect(service.verify(token, { audience: 'requested-audience' })).resolves.toMatchObject({
      subject: 'audience-policy-user',
    });
  });

  it('uses a clockSkewSeconds override to accept a token expired under the default policy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const secret = 'policy-secret';
      const now = Math.floor(Date.now() / 1000);
      const service = createJwtService({ algorithms: ['HS256'], clockSkewSeconds: 0, secret });
      const token = await signAccessToken(
        { algorithms: ['HS256'], secret },
        { exp: now - 1, sub: 'clock-skew-policy-user' },
      );

      await expect(service.verify(token)).rejects.toBeInstanceOf(JwtExpiredTokenError);
      await expect(service.verify(token, { clockSkewSeconds: 2 })).resolves.toMatchObject({
        subject: 'clock-skew-policy-user',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a maxAge override to accept a token too old under the default policy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const secret = 'policy-secret';
      const now = Math.floor(Date.now() / 1000);
      const service = createJwtService({ algorithms: ['HS256'], maxAge: 10, secret });
      const token = await signAccessToken(
        { algorithms: ['HS256'], secret },
        { exp: now + 60, iat: now - 30, sub: 'max-age-policy-user' },
      );

      await expect(service.verify(token)).rejects.toThrow('JWT exceeds maxAge.');
      await expect(service.verify(token, { maxAge: 60 })).resolves.toMatchObject({
        subject: 'max-age-policy-user',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a requireExp override to accept a token missing expiration under the default policy', async () => {
    const secret = 'policy-secret';
    const service = createJwtService({ algorithms: ['HS256'], requireExp: true, secret });
    const token = signTokenWithoutExpiration(secret, { sub: 'require-exp-policy-user' });

    await expect(service.verify(token)).rejects.toBeInstanceOf(JwtInvalidTokenError);
    await expect(service.verify(token)).rejects.toThrow('JWT is missing a required expiration claim.');
    await expect(service.verify(token, { requireExp: false })).resolves.toMatchObject({
      subject: 'require-exp-policy-user',
    });
  });
});
