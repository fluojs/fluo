import { randomUUID } from 'node:crypto';

import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import { DefaultJwtSigner } from './signer.js';
import type { JwtClaims } from './types.js';
import { DefaultJwtVerifier } from './verifier.js';

export interface RefreshTokenStore {
  save(token: RefreshTokenRecord): Promise<void>;
  find(tokenId: string): Promise<RefreshTokenRecord | undefined>;
  revoke(tokenId: string): Promise<void>;
  revokeBySubject(subject: string): Promise<void>;
  consume?(input: RefreshTokenConsumeInput): Promise<RefreshTokenConsumeResult>;
}

export interface RefreshTokenConsumeInput {
  tokenId: string;
  subject: string;
  family: string;
  now: Date;
}

export type RefreshTokenConsumeResult = 'consumed' | 'already_used' | 'expired' | 'not_found' | 'mismatch';

export interface RefreshTokenRecord {
  id: string;
  subject: string;
  family: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface RefreshTokenOptions {
  secret: string;
  expiresInSeconds: number;
  verifyMaxAgeSeconds?: number;
  rotation: boolean;
  store: RefreshTokenStore;
}

export function normalizeRefreshTokenOptions(options: RefreshTokenOptions | undefined): RefreshTokenOptions {
  if (!options) {
    throw new JwtConfigurationError('JWT refresh token options are not configured.');
  }

  if (typeof options.secret !== 'string' || options.secret.length === 0) {
    throw new JwtConfigurationError('JWT refresh token secret must be a non-empty string.');
  }

  if (!Number.isFinite(options.expiresInSeconds) || options.expiresInSeconds <= 0) {
    throw new JwtConfigurationError('JWT refresh token expiresInSeconds must be a positive finite number.');
  }

  if (
    options.verifyMaxAgeSeconds !== undefined
    && (!Number.isFinite(options.verifyMaxAgeSeconds) || options.verifyMaxAgeSeconds < 0)
  ) {
    throw new JwtConfigurationError('JWT refresh token verifyMaxAgeSeconds must be a non-negative finite number.');
  }

  if (options.rotation && typeof options.store.consume !== 'function') {
    throw new JwtConfigurationError('Refresh token rotation requires an atomic store.consume() implementation.');
  }

  return {
    ...options,
  };
}

interface RefreshTokenClaims extends JwtClaims {
  family: string;
  jti: string;
  type: 'refresh';
}

export class RefreshTokenService {
  private readonly options: RefreshTokenOptions;

  constructor(
    options: RefreshTokenOptions,
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {
    this.options = normalizeRefreshTokenOptions(options);
  }

  async issueRefreshToken(subject: string): Promise<string> {
    const family = randomUUID();

    return this.issueRefreshTokenWithFamily(subject, family);
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const claims = await this.verifyRefreshClaims(currentToken);

    if (this.options.rotation) {
      if (!this.options.store.consume) {
        throw new JwtConfigurationError(
          'Refresh token rotation requires an atomic store.consume() implementation.',
        );
      }

      const consumeResult = await this.options.store.consume({
        family: claims.family,
        now: new Date(),
        subject: claims.sub,
        tokenId: claims.jti,
      });

      if (consumeResult === 'consumed') {
        const refreshToken = await this.issueRefreshTokenWithFamily(claims.sub, claims.family);
        const accessToken = await this.signer.signAccessToken({ sub: claims.sub });

        return { accessToken, refreshToken };
      }

      if (consumeResult === 'already_used') {
        await this.options.store.revokeBySubject(claims.sub);
        throw new JwtInvalidTokenError('Refresh token reuse detected.');
      }

      if (consumeResult === 'expired') {
        throw new JwtExpiredTokenError('Refresh token has expired.');
      }

      if (consumeResult === 'not_found') {
        throw new JwtInvalidTokenError('Refresh token record was not found.');
      }

      throw new JwtInvalidTokenError('Refresh token record does not match token claims.');
    }

    const record = await this.options.store.find(claims.jti);

    if (!record) {
      throw new JwtInvalidTokenError('Refresh token record was not found.');
    }

    if (record.subject !== claims.sub || record.family !== claims.family) {
      throw new JwtInvalidTokenError('Refresh token record does not match token claims.');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new JwtExpiredTokenError('Refresh token has expired.');
    }

    if (record.used) {
      await this.options.store.revokeBySubject(record.subject);
      throw new JwtInvalidTokenError('Refresh token reuse detected.');
    }

    const accessToken = await this.signer.signAccessToken({ sub: record.subject });
    return { accessToken, refreshToken: currentToken };
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.options.store.revoke(tokenId);
  }

  async revokeAllForSubject(subject: string): Promise<void> {
    await this.options.store.revokeBySubject(subject);
  }

  private async issueRefreshTokenWithFamily(subject: string, family: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const tokenId = randomUUID();
    const expiresAt = new Date((now + this.options.expiresInSeconds) * 1000);

    await this.options.store.save({
      createdAt: new Date(now * 1000),
      expiresAt,
      family,
      id: tokenId,
      subject,
      used: false,
    });

    const claims: RefreshTokenClaims = {
      exp: Math.floor(expiresAt.getTime() / 1000),
      family,
      iat: now,
      jti: tokenId,
      sub: subject,
      type: 'refresh',
    };

    return this.signer.signRefreshToken(claims);
  }

  private async verifyRefreshClaims(token: string): Promise<RefreshTokenClaims & { sub: string }> {
    const principal = await this.verifier.verifyRefreshToken(token);
    const claims = principal.claims;

    if (claims.type !== 'refresh') {
      throw new JwtInvalidTokenError('JWT is not a refresh token.');
    }

    if (typeof claims.jti !== 'string' || claims.jti.length === 0) {
      throw new JwtInvalidTokenError('Refresh token is missing jti.');
    }

    if (typeof claims.family !== 'string' || claims.family.length === 0) {
      throw new JwtInvalidTokenError('Refresh token is missing family.');
    }

    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new JwtInvalidTokenError('Refresh token is missing sub.');
    }

    return {
      ...claims,
      family: claims.family,
      jti: claims.jti,
      sub: claims.sub,
      type: 'refresh',
    };
  }
}
