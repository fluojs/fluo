import { createHmac, createVerify, timingSafeEqual } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { Inject } from '@konekti/core';

import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import { JwksClient } from './jwks.js';
import type { JwtAlgorithm, JwtClaims, JwtPrincipal, JwtVerifierOptions } from './types.js';

export const JWT_OPTIONS = Symbol.for('konekti.jwt.options');

export const HMAC_HASH: Partial<Record<JwtAlgorithm, string>> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
};

export const ASYMMETRIC_HASH: Partial<Record<JwtAlgorithm, string>> = {
  RS256: 'sha256',
  RS384: 'sha384',
  RS512: 'sha512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
};

function isAllowedAlgorithm(alg: string | undefined, allowed: JwtAlgorithm[]): alg is JwtAlgorithm {
  return typeof alg === 'string' && (allowed as string[]).includes(alg) && (alg in HMAC_HASH || alg in ASYMMETRIC_HASH);
}

function verifyHmacSignature(
  algorithm: JwtAlgorithm,
  secret: string,
  signingInput: string,
  signatureSegment: string,
): void {
  const hash = HMAC_HASH[algorithm];

  if (!hash) {
    throw new JwtInvalidTokenError();
  }

  const expected = encodeBase64Url(createHmac(hash, secret).update(signingInput).digest());
  const expectedBuf = Buffer.from(expected, 'base64url');
  const actualBuf = Buffer.from(signatureSegment, 'base64url');

  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new JwtInvalidTokenError();
  }
}

function verifyAsymmetricSignature(
  algorithm: JwtAlgorithm,
  publicKey: string | KeyObject,
  signingInput: string,
  signatureSegment: string,
): void {
  const hash = ASYMMETRIC_HASH[algorithm];

  if (!hash) {
    throw new JwtInvalidTokenError();
  }

  const verifier = createVerify(hash);
  verifier.update(signingInput);
  const isEc = algorithm.startsWith('ES');
  const valid = verifier.verify(
    isEc
      ? ({ dsaEncoding: 'ieee-p1363', key: publicKey } as Parameters<typeof verifier.verify>[0])
      : publicKey,
    signatureSegment,
    'base64url',
  );
  if (!valid) {
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
  private readonly jwksClient: JwksClient | undefined;

  constructor(private readonly options: JwtVerifierOptions) {
    this.jwksClient = options.jwksUri ? new JwksClient(options.jwksUri, options.jwksCacheTtl) : undefined;
  }

  async verifyAccessToken(token: string): Promise<JwtPrincipal> {
    return this.verifyToken(token, this.options, this.jwksClient);
  }

  async verifyRefreshToken(token: string): Promise<JwtPrincipal> {
    return this.verifyToken(token, this.resolveRefreshVerificationOptions(), undefined);
  }

  private resolveRefreshVerificationOptions(): JwtVerifierOptions {
    const refreshToken = this.options.refreshToken;

    if (!refreshToken) {
      throw new JwtConfigurationError('JWT refresh token options are not configured.');
    }

    return {
      ...this.options,
      algorithms: this.options.algorithms.filter((algorithm) => algorithm in HMAC_HASH),
      jwksUri: undefined,
      keys: undefined,
      privateKey: undefined,
      publicKey: undefined,
      requireExp: true,
      secret: refreshToken.secret,
      secretOrKeyProvider: undefined,
    };
  }

  private async verifyToken(
    token: string,
    options: JwtVerifierOptions,
    jwksClient: JwksClient | undefined,
  ): Promise<JwtPrincipal> {
    const segments = token.split('.');

    if (segments.length !== 3) {
      throw new JwtInvalidTokenError();
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const header = parseJwtPart<{ [key: string]: unknown; alg?: string; kid?: string; typ?: string }>(headerSegment);
    const payload = parseJwtPart<JwtClaims>(payloadSegment);
    const algorithms = options.algorithms;

    if (!isAllowedAlgorithm(header.alg, algorithms)) {
      throw new JwtInvalidTokenError('JWT algorithm is not allowed.');
    }

    const signingInput = `${headerSegment}.${payloadSegment}`;

    if (header.alg in HMAC_HASH) {
      const providerKey = options.secretOrKeyProvider
        ? await options.secretOrKeyProvider({ alg: header.alg, ...header })
        : undefined;

      if (providerKey !== undefined && typeof providerKey !== 'string') {
        throw new JwtConfigurationError('secretOrKeyProvider must return a string for HMAC algorithms.');
      }

      const secret =
        providerKey ??
        ((header.kid !== undefined && header.kid !== ''
          ? options.keys?.find((k) => k.kid === header.kid)?.secret
          : undefined) ?? options.secret);

      if (!secret) {
        throw new JwtConfigurationError('JWT secret is not configured.');
      }

      verifyHmacSignature(header.alg, secret, signingInput, signatureSegment);
    } else {
      const providerKey = options.secretOrKeyProvider
        ? await options.secretOrKeyProvider({ alg: header.alg, ...header })
        : undefined;
      const publicKey =
        providerKey ??
        (jwksClient
          ? await this.resolveJwksPublicKey(header.kid, jwksClient)
          : ((header.kid !== undefined && header.kid !== ''
              ? options.keys?.find((k) => k.kid === header.kid)?.publicKey
              : undefined) ?? options.publicKey));

      if (!publicKey) {
        throw new JwtConfigurationError('JWT public key is not configured.');
      }

      verifyAsymmetricSignature(header.alg, publicKey, signingInput, signatureSegment);
    }

    const now = Math.floor(Date.now() / 1000);
    const clockSkew = options.clockSkewSeconds ?? 0;

    if (options.requireExp !== false && typeof payload.exp !== 'number') {
      throw new JwtInvalidTokenError('JWT is missing a required expiration claim.');
    }

    if (typeof options.maxAge === 'number' && typeof payload.iat === 'number' && now - payload.iat > options.maxAge) {
      throw new JwtExpiredTokenError('JWT exceeds maxAge.');
    }

    if (typeof payload.exp === 'number' && payload.exp + clockSkew < now) {
      throw new JwtExpiredTokenError();
    }

    if (typeof payload.nbf === 'number' && payload.nbf - clockSkew > now) {
      throw new JwtInvalidTokenError('JWT is not active yet.');
    }

    if (options.issuer && payload.iss !== options.issuer) {
      throw new JwtInvalidTokenError('JWT issuer does not match.');
    }

    if (options.audience) {
      const expectedAudience = Array.isArray(options.audience) ? options.audience : [options.audience];
      const actualAudience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];

      if (!expectedAudience.some((audience) => actualAudience.includes(audience))) {
        throw new JwtInvalidTokenError('JWT audience does not match.');
      }
    }

    return normalizePrincipal(payload);
  }

  private async resolveJwksPublicKey(kid: string | undefined, jwksClient: JwksClient): Promise<KeyObject> {
    if (typeof kid !== 'string' || kid.length === 0) {
      throw new JwtInvalidTokenError('JWT is missing key id (kid) for JWKS resolution.');
    }

    return jwksClient.getSigningKey(kid);
  }
}
