import { createHmac, createVerify, timingSafeEqual } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { Inject } from '@konekti/core';

import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import { JwksClient } from './jwks.js';
import { normalizeRefreshTokenOptions } from './refresh-token.js';
import type { JwtAlgorithm, JwtClaims, JwtKeyEntry, JwtPrincipal, JwtVerifierOptions } from './types.js';

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

function isFiniteNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface KeyResolutionState {
  defaultHmacSecret?: string;
  defaultPublicKey?: string | KeyObject;
  hmacKeyCount: number;
  keyByKid: Map<string, JwtKeyEntry>;
  publicKeyCount: number;
}

function createKeyResolutionState(keys: JwtKeyEntry[] | undefined): KeyResolutionState {
  const state: KeyResolutionState = {
    hmacKeyCount: 0,
    keyByKid: new Map<string, JwtKeyEntry>(),
    publicKeyCount: 0,
  };

  if (!Array.isArray(keys) || keys.length === 0) {
    return state;
  }

  for (const entry of keys) {
    state.keyByKid.set(entry.kid, entry);

    if (typeof entry.secret === 'string' && entry.secret.length > 0) {
      state.hmacKeyCount += 1;
      state.defaultHmacSecret = state.hmacKeyCount === 1 ? entry.secret : undefined;
    }

    if (entry.publicKey !== undefined) {
      state.publicKeyCount += 1;
      state.defaultPublicKey = state.publicKeyCount === 1 ? entry.publicKey : undefined;
    }
  }

  return state;
}

function resolveHmacSecret(
  options: JwtVerifierOptions,
  keyState: KeyResolutionState,
  kid: string | undefined,
): string | undefined {
  if (typeof kid === 'string' && kid.length > 0) {
    const matchingKey = keyState.keyByKid.get(kid);

    if (!matchingKey) {
      throw new JwtInvalidTokenError('JWT key id (kid) is not recognized.');
    }

    if (typeof matchingKey.secret !== 'string' || matchingKey.secret.length === 0) {
      throw new JwtConfigurationError(`JWT key "${kid}" does not provide an HMAC secret.`);
    }

    return matchingKey.secret;
  }

  if (keyState.hmacKeyCount > 1) {
    throw new JwtInvalidTokenError('JWT is missing key id (kid) for multi-key HMAC verification.');
  }

  return keyState.defaultHmacSecret ?? options.secret;
}

function resolveStaticPublicKey(
  options: JwtVerifierOptions,
  keyState: KeyResolutionState,
  kid: string | undefined,
): string | KeyObject | undefined {
  if (typeof kid === 'string' && kid.length > 0) {
    // Only consult keyByKid when a multi-key keys[] array was provided.
    // When the verifier is configured with a single options.publicKey, the
    // map is empty and a kid header in the token should be ignored so that
    // verification proceeds with the single configured key.
    if (keyState.keyByKid.size > 0) {
      const matchingKey = keyState.keyByKid.get(kid);

      if (!matchingKey) {
        throw new JwtInvalidTokenError('JWT key id (kid) is not recognized.');
      }

      if (matchingKey.publicKey === undefined) {
        throw new JwtConfigurationError(`JWT key "${kid}" does not provide a public key.`);
      }

      return matchingKey.publicKey;
    }
  }

  if (keyState.publicKeyCount > 1) {
    throw new JwtInvalidTokenError('JWT is missing key id (kid) for multi-key public key verification.');
  }

  return keyState.defaultPublicKey ?? options.publicKey;
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
  private readonly keyResolutionState: KeyResolutionState;
  private readonly refreshVerificationOptions: JwtVerifierOptions | undefined;

  constructor(private readonly options: JwtVerifierOptions) {
    this.jwksClient = options.jwksUri ? new JwksClient(options.jwksUri, options.jwksCacheTtl) : undefined;
    this.keyResolutionState = createKeyResolutionState(options.keys);
    this.refreshVerificationOptions =
      options.refreshToken
        ? this.createRefreshVerificationOptions(normalizeRefreshTokenOptions(options.refreshToken))
        : undefined;
  }

  async verifyAccessToken(token: string): Promise<JwtPrincipal> {
    return this.verifyToken(token, this.options, this.jwksClient);
  }

  async verifyRefreshToken(token: string): Promise<JwtPrincipal> {
    if (!this.refreshVerificationOptions) {
      throw new JwtConfigurationError('JWT refresh token options are not configured.');
    }

    return this.verifyToken(token, this.refreshVerificationOptions, undefined);
  }

  private createRefreshVerificationOptions(
    refreshToken: ReturnType<typeof normalizeRefreshTokenOptions>,
  ): JwtVerifierOptions {
    const algorithms = this.options.algorithms.filter((algorithm): algorithm is JwtAlgorithm => algorithm in HMAC_HASH);

    return {
      algorithms,
      audience: this.options.audience,
      clockSkewSeconds: this.options.clockSkewSeconds,
      issuer: this.options.issuer,
      maxAge: refreshToken.verifyMaxAgeSeconds,
      requireExp: true,
      secret: refreshToken.secret,
    };
  }

  private async verifyToken(
    token: string,
    options: JwtVerifierOptions,
    jwksClient: JwksClient | undefined,
  ): Promise<JwtPrincipal> {
    const [headerSegment, payloadSegment, signatureSegment] = this.parseTokenSegments(token);
    const header = parseJwtPart<{ [key: string]: unknown; alg?: string; kid?: string; typ?: string }>(headerSegment);
    const algorithms = options.algorithms;

    if (!isAllowedAlgorithm(header.alg, algorithms)) {
      throw new JwtInvalidTokenError('JWT algorithm is not allowed.');
    }

    const signingInput = `${headerSegment}.${payloadSegment}`;

    await this.verifyTokenSignature(
      { ...header, alg: header.alg },
      signingInput,
      signatureSegment,
      options,
      jwksClient,
    );

    const payload = parseJwtPart<JwtClaims>(payloadSegment);
    this.validateTokenClaims(payload, options);

    return normalizePrincipal(payload);
  }

  private parseTokenSegments(token: string): [string, string, string] {
    const segments = token.split('.');

    if (segments.length !== 3) {
      throw new JwtInvalidTokenError();
    }

    return segments as [string, string, string];
  }

  private async verifyTokenSignature(
    header: { [key: string]: unknown; alg: JwtAlgorithm; kid?: string },
    signingInput: string,
    signatureSegment: string,
    options: JwtVerifierOptions,
    jwksClient: JwksClient | undefined,
  ): Promise<void> {
    if (header.alg in HMAC_HASH) {
      await this.verifyHmacTokenSignature(header, signingInput, signatureSegment, options);
      return;
    }

    await this.verifyAsymmetricTokenSignature(header, signingInput, signatureSegment, options, jwksClient);
  }

  private async verifyHmacTokenSignature(
    header: { [key: string]: unknown; alg: JwtAlgorithm; kid?: string },
    signingInput: string,
    signatureSegment: string,
    options: JwtVerifierOptions,
  ): Promise<void> {
    const providerKey = await this.resolveProviderKey(options, header);

    if (providerKey !== undefined && typeof providerKey !== 'string') {
      throw new JwtConfigurationError('secretOrKeyProvider must return a string for HMAC algorithms.');
    }

    const secret = providerKey ?? resolveHmacSecret(options, this.keyResolutionState, header.kid);

    if (!secret) {
      throw new JwtConfigurationError('JWT secret is not configured.');
    }

    verifyHmacSignature(header.alg, secret, signingInput, signatureSegment);
  }

  private async verifyAsymmetricTokenSignature(
    header: { [key: string]: unknown; alg: JwtAlgorithm; kid?: string },
    signingInput: string,
    signatureSegment: string,
    options: JwtVerifierOptions,
    jwksClient: JwksClient | undefined,
  ): Promise<void> {
    const providerKey = await this.resolveProviderKey(options, header);
    const publicKey =
      providerKey ??
      (jwksClient
        ? await this.resolveJwksPublicKey(header.kid, jwksClient)
        : resolveStaticPublicKey(options, this.keyResolutionState, header.kid));

    if (!publicKey) {
      throw new JwtConfigurationError('JWT public key is not configured.');
    }

    verifyAsymmetricSignature(header.alg, publicKey, signingInput, signatureSegment);
  }

  private async resolveProviderKey(
    options: JwtVerifierOptions,
    header: { [key: string]: unknown; alg: JwtAlgorithm },
  ): Promise<string | KeyObject | undefined> {
    if (!options.secretOrKeyProvider) {
      return undefined;
    }

    return options.secretOrKeyProvider({ ...header });
  }

  private validateTokenClaims(payload: JwtClaims, options: JwtVerifierOptions): void {
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = options.clockSkewSeconds ?? 0;

    if (options.requireExp !== false && typeof payload.exp !== 'number') {
      throw new JwtInvalidTokenError('JWT is missing a required expiration claim.');
    }

    this.validateMaxAgeClaims(payload, options.maxAge, clockSkew, now);

    if (typeof payload.exp === 'number' && payload.exp + clockSkew < now) {
      throw new JwtExpiredTokenError();
    }

    if (typeof payload.nbf === 'number' && payload.nbf - clockSkew > now) {
      throw new JwtInvalidTokenError('JWT is not active yet.');
    }

    this.validateIssuerAndAudience(payload, options);
  }

  private validateMaxAgeClaims(
    payload: JwtClaims,
    maxAge: number | undefined,
    clockSkew: number,
    now: number,
  ): void {
    if (typeof maxAge !== 'number') {
      return;
    }

    if (!Number.isFinite(maxAge) || maxAge < 0) {
      throw new JwtConfigurationError('JWT maxAge must be a non-negative finite number.');
    }

    if (!isFiniteNumericDate(payload.iat)) {
      throw new JwtInvalidTokenError('JWT iat claim must be a finite numeric date when maxAge is configured.');
    }

    if (payload.iat - clockSkew > now) {
      throw new JwtInvalidTokenError('JWT iat claim cannot be in the future.');
    }

    if (now - payload.iat > maxAge + clockSkew) {
      throw new JwtExpiredTokenError('JWT exceeds maxAge.');
    }
  }

  private validateIssuerAndAudience(payload: JwtClaims, options: JwtVerifierOptions): void {
    if (options.issuer && payload.iss !== options.issuer) {
      throw new JwtInvalidTokenError('JWT issuer does not match.');
    }

    if (!options.audience) {
      return;
    }

    const expectedAudience = Array.isArray(options.audience) ? options.audience : [options.audience];
    const actualAudience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];

    if (!expectedAudience.some((audience) => actualAudience.includes(audience))) {
      throw new JwtInvalidTokenError('JWT audience does not match.');
    }
  }

  private async resolveJwksPublicKey(kid: string | undefined, jwksClient: JwksClient): Promise<KeyObject> {
    if (typeof kid !== 'string' || kid.length === 0) {
      throw new JwtInvalidTokenError('JWT is missing key id (kid) for JWKS resolution.');
    }

    return jwksClient.getSigningKey(kid);
  }
}
