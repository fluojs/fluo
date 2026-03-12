import { createHmac } from 'node:crypto';

import { Inject } from '@konekti/core';

import { JwtInvalidTokenError } from './errors';
import type { JwtClaims, JwtVerifierOptions } from './types';
import { JWT_OPTIONS } from './verifier';

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

@Inject([JWT_OPTIONS])
export class DefaultJwtSigner {
  constructor(private readonly options: JwtVerifierOptions) {}

  async signAccessToken(claims: JwtClaims): Promise<string> {
    const secret = this.options.secret;

    if (!secret) {
      throw new JwtInvalidTokenError('JWT secret is not configured.');
    }

    if (!this.options.algorithms.includes('HS256')) {
      throw new JwtInvalidTokenError('JWT algorithm is not allowed.');
    }

    const now = Math.floor(Date.now() / 1000);
    const ttl = this.options.accessTokenTtlSeconds ?? 3600;
    const payload: JwtClaims = {
      ...claims,
      aud: claims.aud ?? this.options.audience,
      exp: claims.exp ?? now + ttl,
      iat: claims.iat ?? now,
      iss: claims.iss ?? this.options.issuer,
    };
    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signatureSegment = encodeBase64Url(
      createHmac('sha256', secret).update(`${headerSegment}.${payloadSegment}`).digest(),
    );

    return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
  }
}
