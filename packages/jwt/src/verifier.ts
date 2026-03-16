import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject } from '@konekti/core';

import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import type { JwtAlgorithm, JwtClaims, JwtPrincipal, JwtVerifierOptions } from './types.js';

export const JWT_OPTIONS = Symbol.for('konekti.jwt.options');

export const HMAC_HASH: Record<JwtAlgorithm, string> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
};

function isAllowedAlgorithm(alg: string | undefined, allowed: JwtAlgorithm[]): alg is JwtAlgorithm {
  return typeof alg === 'string' && (allowed as string[]).includes(alg) && alg in HMAC_HASH;
}

function verifyHmacSignature(
  algorithm: JwtAlgorithm,
  secret: string,
  signingInput: string,
  signatureSegment: string,
): void {
  const hash = HMAC_HASH[algorithm];
  const expected = encodeBase64Url(createHmac(hash, secret).update(signingInput).digest());
  const expectedBuf = Buffer.from(expected, 'base64url');
  const actualBuf = Buffer.from(signatureSegment, 'base64url');

  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new JwtInvalidTokenError();
  }
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(normalized + padding, 'base64');
}

function parseJwtPart<T>(value: string): T {
  try {
    return JSON.parse(decodeBase64Url(value).toString('utf8')) as T;
  } catch {
    throw new JwtInvalidTokenError();
  }
}

function encodeBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizePrincipal(claims: JwtClaims): JwtPrincipal {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new JwtInvalidTokenError('JWT is missing a valid subject claim.');
  }

  const scopes = Array.isArray(claims.scopes)
    ? claims.scopes.filter((scope): scope is string => typeof scope === 'string')
    : typeof claims.scope === 'string'
      ? claims.scope.split(' ').filter(Boolean)
      : undefined;
  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is string => typeof role === 'string')
    : undefined;

  return {
    audience: claims.aud,
    claims: { ...claims },
    issuer: claims.iss,
    roles,
    scopes,
    subject: claims.sub,
  };
}

@Inject([JWT_OPTIONS])
export class DefaultJwtVerifier {
  constructor(private readonly options: JwtVerifierOptions) {}

  async verifyAccessToken(token: string): Promise<JwtPrincipal> {
    const segments = token.split('.');

    if (segments.length !== 3) {
      throw new JwtInvalidTokenError();
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const header = parseJwtPart<{ alg?: string; typ?: string; kid?: string }>(headerSegment);
    const payload = parseJwtPart<JwtClaims>(payloadSegment);
    const algorithms = this.options.algorithms;

    const secret =
      (header.kid !== undefined && header.kid !== ''
        ? this.options.keys?.find((k) => k.kid === header.kid)?.secret
        : undefined) ?? this.options.secret;

    if (!secret) {
      throw new JwtConfigurationError('JWT secret is not configured.');
    }

    if (!isAllowedAlgorithm(header.alg, algorithms)) {
      throw new JwtInvalidTokenError('JWT algorithm is not allowed.');
    }

    verifyHmacSignature(header.alg, secret, `${headerSegment}.${payloadSegment}`, signatureSegment);

    const now = Math.floor(Date.now() / 1000);
    const clockSkew = this.options.clockSkewSeconds ?? 0;

    if (typeof payload.exp === 'number' && payload.exp + clockSkew < now) {
      throw new JwtExpiredTokenError();
    }

    if (typeof payload.nbf === 'number' && payload.nbf - clockSkew > now) {
      throw new JwtInvalidTokenError('JWT is not active yet.');
    }

    if (this.options.issuer && payload.iss !== this.options.issuer) {
      throw new JwtInvalidTokenError('JWT issuer does not match.');
    }

    if (this.options.audience) {
      const expectedAudience = Array.isArray(this.options.audience) ? this.options.audience : [this.options.audience];
      const actualAudience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];

      if (!expectedAudience.some((audience) => actualAudience.includes(audience))) {
        throw new JwtInvalidTokenError('JWT audience does not match.');
      }
    }

    return normalizePrincipal(payload);
  }
}
