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
  secret: string;
  expiresInSeconds?: number;
  store: RefreshTokenStore | 'memory';
}

function resolveSecret(options: RefreshTokenModuleOptions): string {
  if (!options.secret) {
    throw new JwtConfigurationError(
      'Refresh token secret is not configured. Provide it via RefreshTokenModuleOptions.secret.',
    );
  }

  return options.secret;
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
        return 'invalid';
      }

      if (record.subject !== input.subject || record.family !== input.family) {
        return 'invalid';
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
