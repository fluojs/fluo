import { JwtConfigurationError, JwtExpiredTokenError, JwtInvalidTokenError } from '../errors.js';
import { SUPPORTED_HMAC_HASH } from '../signing/algorithm-policy.js';
import type { DefaultJwtSigner } from '../signing/signer.js';
import type { DefaultJwtVerifier } from '../signing/verifier.js';
import type { JwtAlgorithm } from '../types.js';
import { type RefreshTokenClaims, verifyRefreshTokenClaims } from './refresh-token-claims.js';

/**
 * Describes the refresh token store contract.
 */
export interface RefreshTokenStore {
  save(token: RefreshTokenRecord): Promise<void>;
  find(tokenId: string): Promise<RefreshTokenRecord | undefined>;
  revoke(tokenId: string): Promise<void>;
  revokeBySubject(subject: string): Promise<void>;
  revokeByFamily?(family: string): Promise<void>;
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
  /** HMAC algorithms allowed for refresh-token signing and verification. Defaults to HMAC algorithms from the top-level policy. */
  readonly algorithms?: readonly Extract<JwtAlgorithm, 'HS256' | 'HS384' | 'HS512'>[];
  readonly secret: string;
  readonly expiresInSeconds: number;
  readonly verifyMaxAgeSeconds?: number;
  readonly rotation: boolean;
  /** Application-owned durable store, or the explicit development-only in-memory store. */
  readonly store: RefreshTokenStore | 'memory';
}

type NormalizedRefreshTokenOptions = Omit<RefreshTokenOptions, 'store'> & {
  readonly store: RefreshTokenStore;
};

function isRefreshTokenStore(value: unknown): value is RefreshTokenStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const store = value as Partial<RefreshTokenStore>;
  return typeof store.save === 'function'
    && typeof store.find === 'function'
    && typeof store.revoke === 'function'
    && typeof store.revokeBySubject === 'function'
    && (store.revokeByFamily === undefined || typeof store.revokeByFamily === 'function')
    && (store.consume === undefined || typeof store.consume === 'function')
    && (store.rotate === undefined || typeof store.rotate === 'function');
}

class MemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly records = new Map<string, RefreshTokenRecord>();

  async save(token: RefreshTokenRecord): Promise<void> {
    this.records.set(token.id, token);
  }

  async find(tokenId: string): Promise<RefreshTokenRecord | undefined> {
    return this.records.get(tokenId);
  }

  async revoke(tokenId: string): Promise<void> {
    this.records.delete(tokenId);
  }

  async revokeBySubject(subject: string): Promise<void> {
    for (const [id, record] of this.records.entries()) {
      if (record.subject === subject) {
        this.records.delete(id);
      }
    }
  }

  async revokeByFamily(family: string): Promise<void> {
    for (const [id, record] of this.records.entries()) {
      if (record.family === family) {
        this.records.delete(id);
      }
    }
  }

  async rotate(input: RefreshTokenRotateInput): Promise<RefreshTokenConsumeResult> {
    const current = this.records.get(input.tokenId);

    if (!current) {
      return 'not_found';
    }

    if (current.subject !== input.subject || current.family !== input.family) {
      return 'mismatch';
    }

    if (current.expiresAt.getTime() <= input.now.getTime()) {
      return 'expired';
    }

    if (current.used) {
      return 'already_used';
    }

    this.records.set(current.id, { ...current, used: true });
    this.records.set(input.replacement.id, input.replacement);
    return 'consumed';
  }
}

/**
 * Normalizes refresh token options for internal JWT provider assembly.
 *
 * @param options The options.
 * @returns The normalize refresh token options result.
 */
export function normalizeRefreshTokenOptions(
  options: RefreshTokenOptions | undefined,
): NormalizedRefreshTokenOptions {
  if (!options) {
    throw new JwtConfigurationError('JWT refresh token options are not configured.');
  }

  if (options.algorithms !== undefined) {
    if (!Array.isArray(options.algorithms) || options.algorithms.length === 0) {
      throw new JwtConfigurationError('JWT refresh token algorithms must contain at least one HMAC algorithm.');
    }

    for (const algorithm of options.algorithms) {
      if (typeof algorithm !== 'string' || !Object.hasOwn(SUPPORTED_HMAC_HASH, algorithm)) {
        throw new JwtConfigurationError(
          `JWT refresh token received unsupported algorithm "${String(algorithm)}"; only HS256, HS384, and HS512 are allowed.`,
        );
      }
    }
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

  const store: RefreshTokenStore = options.store === 'memory' ? new MemoryRefreshTokenStore() : options.store;

  if (!isRefreshTokenStore(store)) {
    throw new JwtConfigurationError(
      'JWT refresh token store must implement save(), find(), revoke(), and revokeBySubject().',
    );
  }

  if (options.rotation && typeof store.rotate !== 'function' && typeof store.consume !== 'function') {
    throw new JwtConfigurationError(
      'Refresh token rotation requires an atomic store.rotate() or store.consume() implementation.',
    );
  }

  return {
    ...options,
    store,
  };
}

/**
 * Represents the refresh token service.
 */
export class RefreshTokenService {
  private readonly options: NormalizedRefreshTokenOptions;

  constructor(
    options: RefreshTokenOptions,
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {
    this.options = normalizeRefreshTokenOptions(options);
  }

  async issueRefreshToken(subject: string): Promise<string> {
    const { randomUUID } = await import('node:crypto');
    const family = randomUUID();

    return this.issueRefreshTokenWithFamily(subject, family);
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const claims = await verifyRefreshTokenClaims(this.verifier, currentToken);

    if (this.options.rotation) {
      if (!this.options.store.rotate && !this.options.store.consume) {
        throw new JwtConfigurationError(
          'Refresh token rotation requires an atomic store.rotate() or store.consume() implementation.',
        );
      }

      const next = await this.createRefreshTokenWithFamily(claims.sub, claims.family);
      const accessToken = await this.signer.signAccessToken({ sub: claims.sub });
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

        return { accessToken, refreshToken: next.token };
      }

      if (consumeResult === 'already_used') {
        await this.revokeCompromisedFamily(claims.sub, claims.family);
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
      await this.revokeCompromisedFamily(record.subject, record.family);
      throw new JwtInvalidTokenError('Refresh token reuse detected.');
    }

    const accessToken = await this.signer.signAccessToken({ sub: record.subject });
    return { accessToken, refreshToken: currentToken };
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.options.store.revoke(tokenId);
  }

  /**
   * Revokes the record identified by a verified presented refresh token.
   *
   * @param token Compact refresh token to verify before its record is revoked.
   * @returns A promise that resolves after the verified refresh-token record is revoked.
   * @throws {JwtInvalidTokenError} When the token is malformed or lacks required refresh claims.
   * @throws {JwtExpiredTokenError} When the refresh token has expired.
   */
  async revokePresentedRefreshToken(token: string): Promise<void> {
    const claims = await verifyRefreshTokenClaims(this.verifier, token);

    await this.options.store.revoke(claims.jti);
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

  private async revokeCompromisedFamily(subject: string, family: string): Promise<void> {
    if (this.options.store.revokeByFamily) {
      await this.options.store.revokeByFamily(family);
      return;
    }

    await this.options.store.revokeBySubject(subject);
  }

  private async createRefreshTokenWithFamily(
    subject: string,
    family: string,
  ): Promise<{ record: RefreshTokenRecord; token: string }> {
    const now = Math.floor(Date.now() / 1000);
    const { randomUUID } = await import('node:crypto');
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
}
