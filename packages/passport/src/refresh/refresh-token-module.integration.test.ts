import { Inject, Module } from '@fluojs/core';
import {
  JwtInvalidTokenError,
  JwtModule,
  type RefreshTokenRecord,
  RefreshTokenService as JwtRefreshTokenService,
  type RefreshTokenRotateInput,
  type RefreshTokenStore as JwtRefreshTokenStore,
} from '@fluojs/jwt';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { PassportModule } from '../module.js';
import {
  REFRESH_TOKEN_SERVICE,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
  type RefreshTokenServicePort,
  RefreshTokenStrategy,
} from './refresh-token.js';

class RotatingRefreshTokenStore implements JwtRefreshTokenStore {
  private readonly records = new Map<string, RefreshTokenRecord>();
  revokeByFamilyCalls = 0;
  rotateCalls = 0;

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
    this.revokeByFamilyCalls += 1;

    for (const [id, record] of this.records.entries()) {
      if (record.family === family) {
        this.records.delete(id);
      }
    }
  }

  async rotate(input: RefreshTokenRotateInput): Promise<'consumed' | 'already_used' | 'expired' | 'not_found' | 'mismatch' | 'invalid'> {
    this.rotateCalls += 1;
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

class ApplicationRefreshTokenService implements RefreshTokenServicePort {
  async issueRefreshToken(subject: string): Promise<string> {
    return `refresh:${subject}`;
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return {
      accessToken: `access:${currentToken}`,
      refreshToken: `rotated:${currentToken}`,
    };
  }

  async revokeRefreshToken(): Promise<void> {}

  async revokeAllForSubject(): Promise<void> {}
}

class RefreshTokenStore {
  readonly prefix = 'application-owned';
}

@Inject(RefreshTokenStore)
class DependencyfulRefreshTokenService implements RefreshTokenServicePort {
  constructor(private readonly store: RefreshTokenStore) {}

  async issueRefreshToken(subject: string): Promise<string> {
    return `${this.store.prefix}:${subject}`;
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return {
      accessToken: `${this.store.prefix}:access:${currentToken}`,
      refreshToken: `${this.store.prefix}:refresh:${currentToken}`,
    };
  }

  async revokeRefreshToken(): Promise<void> {}

  async revokeAllForSubject(): Promise<void> {}
}

describe('RefreshTokenModule application wiring', () => {
  it('shares JwtModule refresh state with Passport strategy exchanges', async () => {
    // Given — JwtModule owns the refresh configuration and durable rotation store.
    const store = new RotatingRefreshTokenStore();

    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          refreshToken: {
            expiresInSeconds: 60,
            rotation: true,
            secret: 'refresh-integration-secret',
            store,
          },
          secret: 'access-integration-secret',
        }),
        RefreshTokenModule.forRoot(),
        PassportModule.forRoot(
          { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
          [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
        ),
      ],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const refreshTokens = await app.container.resolve(JwtRefreshTokenService);
      const strategy = await app.container.resolve(RefreshTokenStrategy);
      const presentedToken = await refreshTokens.issueRefreshToken('user-1');
      const independentToken = await refreshTokens.issueRefreshToken('user-1');

      // When — Passport rotates a token the JWT service issued.
      const principal = await strategy.authenticate({
        handler: {} as never,
        requestContext: {
          request: {
            body: { refreshToken: presentedToken },
            headers: {},
          },
        } as never,
      });

      // Then — both paths observe one store, one rotation state, and family-only replay revocation.
      expect(principal).toMatchObject({
        claims: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
        subject: 'user-1',
      });
      expect(store.rotateCalls).toBe(1);
      await expect(refreshTokens.rotateRefreshToken(presentedToken)).rejects.toBeInstanceOf(JwtInvalidTokenError);
      expect(store.revokeByFamilyCalls).toBe(1);
      await expect(refreshTokens.rotateRefreshToken(independentToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('compiles the documented application graph with module-owned service provider ownership', async () => {
    // Given — the documented topology passes the service class to RefreshTokenModule without
    // re-registering it in the importing application module.
    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'refresh-integration-secret',
        }),
        RefreshTokenModule.forRoot(ApplicationRefreshTokenService),
        PassportModule.forRoot(
          { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
          [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
        ),
      ],
    })
    class AuthModule {}

    // When
    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const strategy = await app.container.resolve(RefreshTokenStrategy);
      const service = await app.container.resolve<RefreshTokenServicePort>(REFRESH_TOKEN_SERVICE);

      // Then
      expect(strategy).toBeInstanceOf(RefreshTokenStrategy);
      expect(service).toBeInstanceOf(ApplicationRefreshTokenService);
    } finally {
      await app.close();
    }
  });

  it('compiles module-owned services with application-owned dependencies under strict policy', async () => {
    // Given — the application owns and exports the refresh service's constructor dependency.
    @Module({
      exports: [RefreshTokenStore],
      providers: [RefreshTokenStore],
    })
    class RefreshTokenDependenciesModule {}

    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'refresh-integration-secret',
        }),
        RefreshTokenModule.forRoot(DependencyfulRefreshTokenService, {
          imports: [RefreshTokenDependenciesModule],
        }),
        PassportModule.forRoot(
          { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
          [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
        ),
      ],
    })
    class AuthModule {}

    // When
    const app = await FluoFactory.createApplicationContext(AuthModule, {
      duplicateProviderPolicy: 'throw',
    });

    try {
      const strategy = await app.container.resolve(RefreshTokenStrategy);
      const service = await app.container.resolve<RefreshTokenServicePort>(REFRESH_TOKEN_SERVICE);

      // Then
      expect(strategy).toBeInstanceOf(RefreshTokenStrategy);
      expect(await service.issueRefreshToken('user-1')).toBe('application-owned:user-1');
    } finally {
      await app.close();
    }
  });

  it('resolves an imported symbol service through the exported alias', async () => {
    // Given — the imported module owns and exports the non-class service token.
    const serviceToken = Symbol('fluo.passport.refresh-token-service');
    const service = new ApplicationRefreshTokenService();

    @Module({
      exports: [serviceToken],
      providers: [{ provide: serviceToken, useValue: service }],
    })
    class RefreshTokenServicesModule {}

    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'refresh-integration-secret',
        }),
        RefreshTokenModule.forRoot(serviceToken, {
          imports: [RefreshTokenServicesModule],
        }),
      ],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule, {
      duplicateProviderPolicy: 'throw',
    });

    try {
      // When
      const resolvedService = await app.container.resolve(REFRESH_TOKEN_SERVICE);

      // Then
      expect(resolvedService).toBe(service);
    } finally {
      await app.close();
    }
  });

  it('resolves an imported string service through the exported alias under strict policy', async () => {
    // Given — the imported module owns and exports the non-class service token.
    const serviceToken = 'fluo.passport.refresh-token-service';
    const service = new ApplicationRefreshTokenService();

    @Module({
      exports: [serviceToken],
      providers: [{ provide: serviceToken, useValue: service }],
    })
    class RefreshTokenServicesModule {}

    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'refresh-integration-secret',
        }),
        RefreshTokenModule.forRoot(serviceToken, {
          imports: [RefreshTokenServicesModule],
        }),
      ],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule, {
      duplicateProviderPolicy: 'throw',
    });

    try {
      // When
      const resolvedService = await app.container.resolve(REFRESH_TOKEN_SERVICE);

      // Then
      expect(resolvedService).toBe(service);
    } finally {
      await app.close();
    }
  });

});
