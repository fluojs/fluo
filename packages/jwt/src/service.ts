import { Inject } from '@konekti/core';

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

export interface SignOptions {
  audience?: JwtVerifierOptions['audience'];
  expiresIn?: number | `${number}${DurationUnit}`;
  issuer?: string;
  notBefore?: number;
  subject?: string;
}

export interface VerifyOptions {
  algorithms?: JwtVerifierOptions['algorithms'];
  audience?: JwtVerifierOptions['audience'];
  clockSkewSeconds?: number;
  issuer?: string;
  maxAge?: number;
  requireExp?: boolean;
}

@Inject([JWT_OPTIONS, DefaultJwtSigner, DefaultJwtVerifier])
export class JwtService {
  constructor(
    private readonly options: JwtVerifierOptions,
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {}

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
