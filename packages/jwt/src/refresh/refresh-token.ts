import { randomUUID } from 'node:crypto';

import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from '../errors.js';
import type { DefaultJwtSigner } from '../signing/signer.js';
import type { JwtClaims } from '../types.js';
import type { DefaultJwtVerifier } from '../signing/verifier.js';

/**
 * Describes the refresh token store contract.
 */
export interface RefreshTokenStore {
  save(token: RefreshTokenRecord): Promise<void>;
  find(tokenId: string): Promise<RefreshTokenRecord | undefined>;
  revoke(tokenId: string): Promise<void>;
  revokeBySubject(subject: string): Promise<void>;
  consume?(input: RefreshTokenConsumeInput): Promise<RefreshTokenConsumeResult>;
  rotate?(input: RefreshTokenRotateInput): Promise<RefreshTokenConsumeResult>;
}

/**
 * Describes the refresh token consume input contract.
 */
export interface RefreshTokenConsumeInput {
  tokenId: string;
  subject: string;
  family: string;
  now: Date;
}

/**
 * Describes the durable refresh token rotation input contract.
 */
export interface RefreshTokenRotateInput extends RefreshTokenConsumeInput {
  replacement: RefreshTokenRecord;
}

/**
 * Defines the refresh token consume result type.
 */
export type RefreshTokenConsumeResult = 'consumed' | 'already_used' | 'expired' | 'not_found' | 'mismatch' | 'invalid';

/**
 * Describes the refresh token record contract.
 */
export interface RefreshTokenRecord {
  id: string;
  subject: string;
  family: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

/**
 * Describes the refresh token options contract.
 */
export interface RefreshTokenOptions {
  secret: string;
  expiresInSeconds: number;
  verifyMaxAgeSeconds?: number;
  rotation: boolean;
  store: RefreshTokenStore;
}

/**
 * Normalize refresh token options.
 *
 * @param options The options.
 * @returns The normalize refresh token options result.
 */
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

  if (options.rotation && typeof options.store.rotate !== 'function' && typeof options.store.consume !== 'function') {
    throw new JwtConfigurationError(
      'Refresh token rotation requires an atomic store.rotate() or store.consume() implementation.',
    );
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

/**
 * Represents the refresh token service.
 */
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
      if (!this.options.store.rotate && !this.options.store.consume) {
        throw new JwtConfigurationError(
          'Refresh token rotation requires an atomic store.rotate() or store.consume() implementation.',
        );
      }

      const next = await this.createRefreshTokenWithFamily(claims.sub, claims.family);
      const consumeResult = this.options.store.rotate
        ? await this.options.store.rotate({
          family: claims.family,
          now: new Date(),
          replacement: next.record,
          subject: claims.sub,
          tokenId: claims.jti,
        })
        : await this.consumeRefreshToken({
          family: claims.family,
          now: new Date(),
          subject: claims.sub,
          tokenId: claims.jti,
        });

      if (consumeResult === 'consumed') {
        if (!this.options.store.rotate) {
          await this.options.store.save(next.record);
        }
        const accessToken = await this.signer.signAccessToken({ sub: claims.sub });

        return { accessToken, refreshToken: next.token };
      }

      if (consumeResult === 'already_used') {
        await this.options.store.revokeBySubject(claims.sub);
        throw new JwtInvalidTokenError('Refresh token reuse detected.');
      }

      if (consumeResult === 'expired') {
        throw new JwtExpiredTokenError('Refresh token has expired.');
      }

      if (consumeResult === 'not_found' || consumeResult === 'invalid') {
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
    const { record, token } = await this.createRefreshTokenWithFamily(subject, family);

    await this.options.store.save(record);

    return token;
  }

  private async consumeRefreshToken(input: RefreshTokenConsumeInput): Promise<RefreshTokenConsumeResult> {
    if (!this.options.store.consume) {
      throw new JwtConfigurationError(
        'Refresh token rotation requires an atomic store.rotate() or store.consume() implementation.',
      );
    }

    return this.options.store.consume(input);
  }

  private async createRefreshTokenWithFamily(
    subject: string,
    family: string,
  ): Promise<{ record: RefreshTokenRecord; token: string }> {
    const now = Math.floor(Date.now() / 1000);
    const tokenId = randomUUID();
    const expiresAt = new Date((now + this.options.expiresInSeconds) * 1000);
    const record = {
      createdAt: new Date(now * 1000),
      expiresAt,
      family,
      id: tokenId,
      subject,
      used: false,
    };

    const claims: RefreshTokenClaims = {
      exp: Math.floor(expiresAt.getTime() / 1000),
      family,
      iat: now,
      jti: tokenId,
      sub: subject,
      type: 'refresh',
    };

    const token = await this.signer.signRefreshToken(claims);

    return { record, token };
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
