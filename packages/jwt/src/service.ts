import { Inject } from '@fluojs/core';

import { DefaultJwtSigner } from './signing/signer.js';
import type { JwtClaims, JwtVerifierOptions } from './types.js';
import { DefaultJwtVerifier, JWT_OPTIONS } from './signing/verifier.js';

type DurationUnit = 's' | 'm' | 'h' | 'd';

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(normalized + padding, 'base64');
}

function parseDurationUnitToSeconds(unit: DurationUnit): number {
  switch (unit) {
    case 's':
      return 1;
    case 'm':
      return 60;
    case 'h':
      return 60 * 60;
    case 'd':
      return 60 * 60 * 24;
  }
}

function parseExpiresInSeconds(expiresIn: SignOptions['expiresIn']): number | undefined {
  if (expiresIn === undefined) {
    return undefined;
  }

  if (typeof expiresIn === 'number') {
    if (!Number.isFinite(expiresIn) || expiresIn < 0) {
      throw new Error('JwtService.sign() options.expiresIn must be a non-negative finite number.');
    }

    return Math.floor(expiresIn);
  }

  const trimmed = expiresIn.trim();
  const match = trimmed.match(/^(\d+)([smhd])$/i);

  if (!match) {
    throw new Error('JwtService.sign() options.expiresIn must be a number or duration string like "60s", "15m", "1h", "7d".');
  }

  const value = Number.parseInt(match[1] ?? '', 10);
  const rawUnit = match[2]?.toLowerCase();

  if (!rawUnit || !['s', 'm', 'h', 'd'].includes(rawUnit)) {
    throw new Error('JwtService.sign() options.expiresIn uses an unsupported duration unit.');
  }

  return value * parseDurationUnitToSeconds(rawUnit as DurationUnit);
}

/**
 * Per-call claim overrides accepted by {@link JwtService.sign}.
 *
 * Use these options when one token needs narrower issuer, audience, subject, or
 * lifetime semantics than the module-level signer defaults.
 */
export interface SignOptions {
  /**
   * Overrides the token `aud` claim for this signing call.
   *
   * Match this with the verifier-side `audience` expectation to prevent a token
   * minted for one consumer from being accepted by another.
   */
  audience?: JwtVerifierOptions['audience'];
  /**
   * Sets the token lifetime relative to the current clock.
   *
   * Accepts seconds or a short duration literal such as `"60s"`, `"15m"`,
   * `"1h"`, or `"7d"`.
   */
  expiresIn?: number | `${number}${DurationUnit}`;
  /**
   * Overrides the token `iss` claim for this signing call.
   *
   * Keep issuer values stable so downstream verifiers can reject tokens from
   * unexpected environments or services.
   */
  issuer?: string;
  /**
   * Sets the `nbf` claim as a NumericDate in seconds.
   *
   * Tokens remain invalid until the verifier clock reaches this timestamp.
   */
  notBefore?: number;
  /**
   * Overrides the token `sub` claim for this signing call.
   */
  subject?: string;
}

/**
 * Per-call verification overrides accepted by {@link JwtService.verify}.
 *
 * These options are merged on top of the module-level verifier policy for the
 * current token check only.
 */
export interface VerifyOptions {
  /**
   * Restricts which JWT algorithms are allowed for this verification call.
   */
  algorithms?: JwtVerifierOptions['algorithms'];
  /**
   * Expected `aud` claim value or values.
   *
   * Provide this when a token should only be accepted for a specific API or
   * client boundary.
   */
  audience?: JwtVerifierOptions['audience'];
  /**
   * Permitted clock skew in seconds when evaluating `exp`, `nbf`, and age-based
   * checks.
   */
  clockSkewSeconds?: number;
  /**
   * Expected `iss` claim value for this verification call.
   */
  issuer?: string;
  /**
   * Maximum acceptable token age in seconds, calculated from the `iat` claim.
   *
   * When set, tokens without a finite `iat` claim are rejected.
   */
  maxAge?: number;
  /**
   * Controls whether `exp` must be present on the token.
   *
   * Leave this enabled for access tokens unless the issuing system explicitly
   * documents a different contract.
   */
  requireExp?: boolean;
}

/**
 * NestJS-style facade over Konekti's default JWT signer and verifier.
 *
 * @remarks
 * This class keeps the low-level JWT behavior from {@link DefaultJwtSigner} and
 * {@link DefaultJwtVerifier}, but exposes a smaller `sign` / `verify` /
 * `decode` surface for applications migrating from similar auth service
 * patterns.
 */
@Inject(JWT_OPTIONS, DefaultJwtSigner, DefaultJwtVerifier)
export class JwtService {
  constructor(
    private readonly options: JwtVerifierOptions,
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {}

  /**
   * Signs a JWT access token from arbitrary claim payload plus optional claim overrides.
   *
   * @example
   * ```ts
   * const token = await jwtService.sign(
   *   { role: 'admin' },
   *   { audience: 'admin-ui', expiresIn: '15m', subject: 'user-123' },
   * );
   * ```
   *
   * @param payload Base JWT claims to embed in the token payload.
   * @param options Optional per-call overrides for `aud`, `iss`, `sub`, `nbf`, and `exp`.
   * @returns A signed JWT string suitable for bearer-token transport.
   * @throws {Error} When `options.expiresIn` is not a supported non-negative duration.
   */
  async sign(payload: object, options?: SignOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = parseExpiresInSeconds(options?.expiresIn);
    const claims: JwtClaims = {
      ...(payload as JwtClaims),
      aud: options?.audience ?? (payload as JwtClaims).aud,
      exp:
        expiresInSeconds !== undefined
          ? ((payload as JwtClaims).exp ?? now + expiresInSeconds)
          : (payload as JwtClaims).exp,
      iss: options?.issuer ?? (payload as JwtClaims).iss,
      nbf: options?.notBefore ?? (payload as JwtClaims).nbf,
      sub: options?.subject ?? (payload as JwtClaims).sub,
    };

    return this.signer.signAccessToken(claims);
  }

  /**
   * Verifies a JWT and returns the decoded claim bag typed as `T`.
   *
   * @example
   * ```ts
   * const claims = await jwtService.verify<{ sub: string; scope?: string }>(token, {
   *   audience: 'admin-ui',
   *   issuer: 'my-api',
   *   requireExp: true,
   * });
   * ```
   *
   * @param token Compact JWT string to verify.
   * @param options Optional per-call verifier overrides layered on top of module defaults.
   * @returns The verified token claims cast to the requested generic type.
   * @throws {JwtInvalidTokenError} When the token is malformed or violates issuer/audience/claim requirements.
   * @throws {JwtExpiredTokenError} When the token is expired or exceeds `maxAge`.
   * @throws {JwtConfigurationError} When the active verifier configuration cannot validate the token.
   */
  async verify<T = unknown>(token: string, options?: VerifyOptions): Promise<T> {
    const verifier = options
      ? new DefaultJwtVerifier({
          ...this.options,
          algorithms: options.algorithms ?? this.options.algorithms,
          audience: options.audience ?? this.options.audience,
          clockSkewSeconds: options.clockSkewSeconds ?? this.options.clockSkewSeconds,
          issuer: options.issuer ?? this.options.issuer,
          maxAge: options.maxAge ?? this.options.maxAge,
          requireExp: options.requireExp ?? this.options.requireExp,
        })
      : this.verifier;
    const principal = await verifier.verifyAccessToken(token);

    return principal.claims as T;
  }

  /**
   * Decodes the JWT payload segment without verifying signature or claims.
   *
   * @remarks
   * Use this only for diagnostics or non-authoritative inspection. Call
   * {@link JwtService.verify} before trusting any returned claim value.
   *
   * @param token Compact JWT string to inspect.
   * @returns The decoded payload object, or `null` when the token is malformed.
   */
  decode(token: string): unknown {
    const segments = token.split('.');

    if (segments.length !== 3) {
      return null;
    }

    const [, payloadSegment] = segments;

    if (!payloadSegment) {
      return null;
    }

    try {
      return JSON.parse(decodeBase64Url(payloadSegment).toString('utf8')) as unknown;
    } catch {
      return null;
    }
  }
}
