import { Inject } from '@konekti/core';
import {
  DefaultJwtSigner,
  DefaultJwtVerifier,
  JwtConfigurationError,
  RefreshTokenService as JwtRefreshTokenService,
  type RefreshTokenStore,
} from '@konekti/jwt';

import type { RefreshTokenService } from './refresh-token.js';

export const REFRESH_TOKEN_MODULE_OPTIONS = Symbol.for('konekti.passport.refresh-token-module-options');

export interface RefreshTokenModuleOptions {
  /**
   * Secret used to sign refresh tokens.
   * Defaults to the `REFRESH_TOKEN_SECRET` environment variable if not provided.
   */
  secret?: string;
  /**
   * Refresh token lifetime in seconds.
   * Defaults to 604800 (7 days) if not provided.
   */
  expiresInSeconds?: number;
  /**
   * Persistent store for refresh token records.
   * Pass `'memory'` to explicitly opt into the in-memory store (development / single-instance only).
   * Omitting this field causes a startup error, ensuring production deployments provide a real store.
   */
  store: RefreshTokenStore | 'memory';
}

function resolveSecret(options: RefreshTokenModuleOptions): string {
  if (options.secret) {
    return options.secret;
  }

  const envSecret = process.env.REFRESH_TOKEN_SECRET;
  if (!envSecret) {
    throw new JwtConfigurationError(
      'Refresh token secret is not configured. Provide it via RefreshTokenModuleOptions.secret or the REFRESH_TOKEN_SECRET environment variable.',
    );
  }

  return envSecret;
}

function createInMemoryStore(): RefreshTokenStore {
  const records = new Map<string, {
    id: string;
    subject: string;
    family: string;
    expiresAt: Date;
    used: boolean;
    createdAt: Date;
  }>();

  return {
    async save(token: {
      id: string;
      subject: string;
      family: string;
      expiresAt: Date;
      used: boolean;
      createdAt: Date;
    }): Promise<void> {
      records.set(token.id, token);
    },

    async find(tokenId: string) {
      return records.get(tokenId);
    },

    async revoke(tokenId: string): Promise<void> {
      records.delete(tokenId);
    },

    async revokeBySubject(subject: string): Promise<void> {
      for (const [id, record] of records.entries()) {
        if (record.subject === subject) {
          records.delete(id);
        }
      }
    },

    async consume(input: { tokenId: string; subject: string; family: string; now: Date }) {
      const record = records.get(input.tokenId);

      if (!record) {
        return 'not_found';
      }

      if (record.subject !== input.subject || record.family !== input.family) {
        return 'mismatch';
      }

      if (record.expiresAt.getTime() <= input.now.getTime()) {
        return 'expired';
      }

      if (record.used) {
        return 'already_used';
      }

      records.set(input.tokenId, { ...record, used: true });
      return 'consumed';
    },
  };
}

@Inject([DefaultJwtSigner, DefaultJwtVerifier, REFRESH_TOKEN_MODULE_OPTIONS])
export class JwtRefreshTokenAdapter implements RefreshTokenService {
  private readonly service: JwtRefreshTokenService;

  constructor(
    signer: DefaultJwtSigner,
    verifier: DefaultJwtVerifier,
    options: RefreshTokenModuleOptions,
  ) {
    if (!options.store) {
      throw new JwtConfigurationError(
        'JwtRefreshTokenAdapter requires a persistent RefreshTokenStore. ' +
        'Provide one via RefreshTokenModuleOptions.store, or pass store: \'memory\' to explicitly opt into the in-memory store (single-instance / development only).',
      );
    }

    const store = options.store === 'memory' ? createInMemoryStore() : options.store;

    this.service = new JwtRefreshTokenService(
      {
        expiresInSeconds: options.expiresInSeconds ?? 604800,
        rotation: true,
        secret: resolveSecret(options),
        store,
      },
      signer,
      verifier,
    );
  }

  async issueRefreshToken(subject: string): Promise<string> {
    return this.service.issueRefreshToken(subject);
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return this.service.rotateRefreshToken(currentToken);
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    return this.service.revokeRefreshToken(tokenId);
  }

  async revokeAllForSubject(subject: string): Promise<void> {
    return this.service.revokeAllForSubject(subject);
  }
}
