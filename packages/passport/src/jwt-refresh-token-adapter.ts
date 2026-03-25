import { Inject } from '@konekti/core';
import { DefaultJwtSigner, DefaultJwtVerifier, JwtConfigurationError, RefreshTokenService as JwtRefreshTokenService } from '@konekti/jwt';

import type { RefreshTokenService } from './refresh-token.js';

@Inject([DefaultJwtSigner, DefaultJwtVerifier])
export class JwtRefreshTokenAdapter implements RefreshTokenService {
  private readonly service: JwtRefreshTokenService;

  private static resolveSecret(): string {
    const secret = process.env.REFRESH_TOKEN_SECRET;

    if (!secret) {
      throw new JwtConfigurationError(
        'REFRESH_TOKEN_SECRET environment variable is required. Set it to a strong, random secret.',
      );
    }

    return secret;
  }

  constructor(
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {
    this.service = new JwtRefreshTokenService(
      {
        expiresInSeconds: 3600,
        rotation: true,
        secret: JwtRefreshTokenAdapter.resolveSecret(),
        store: this.createDefaultStore(),
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

  private createDefaultStore() {
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
}
