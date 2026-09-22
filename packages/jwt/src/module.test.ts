import { describe, expect, it, vi } from 'vitest';

import { Inject, Module, type Constructor, type Token } from '@fluojs/core';
import { defineFrameworkServiceIdentity, getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { FluoFactory } from '@fluojs/runtime';

import * as jwtRootExports from './index.js';
import { JwtModule } from './module.js';
import { RefreshTokenService } from './refresh/refresh-token.js';
import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signing/signer.js';
import { DefaultJwtVerifier } from './signing/verifier.js';

@Inject(JwtService)
class JwtRoundTripService {
  constructor(private readonly jwt: JwtService) {}

  async signAndVerify(subject: string): Promise<string> {
    const token = await this.jwt.sign({ sub: subject });
    const principal = await this.jwt.verify(token);

    return principal.subject;
  }
}

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('JwtModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

function providerToken(provider: Provider): Token {
  if (typeof provider === 'function') {
    return provider;
  }

  return provider.provide;
}

function moduleExports(moduleType: Constructor): Token[] {
  return (getModuleMetadata(moduleType)?.exports as Token[] | undefined) ?? [];
}

async function createJwtApplicationContext(jwtModule: Constructor) {
  @Module({ imports: [jwtModule] })
  class AppModule {}

  return FluoFactory.createApplicationContext(AppModule);
}

describe('JwtModule', () => {
  it('does not expose the provider-composition helper from the package root', () => {
    expect(jwtRootExports).not.toHaveProperty('createJwtCoreProviders');
  });

  it('does not expose refresh-token normalization from the package root', () => {
    expect(jwtRootExports).toHaveProperty('RefreshTokenService');
    expect(jwtRootExports).not.toHaveProperty('normalizeRefreshTokenOptions');
  });

  it('disposes verifier-owned JWKS cache entries during module shutdown', async () => {
    const disposeSpy = vi.spyOn(DefaultJwtVerifier.prototype, 'dispose');
    const app = await createJwtApplicationContext(JwtModule.forRoot({
      algorithms: ['RS256'],
      jwksUri: 'https://issuer.example.test/.well-known/jwks.json',
    }));

    try {
      await app.close();
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it('supports synchronous forRoot registration', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      issuer: 'jwt-module-tests',
      secret: 'sync-secret',
    });

    container.register(...moduleProviders(moduleType), JwtRoundTripService);
    const service = await container.resolve(JwtRoundTripService);

    await expect(service.signAndVerify('sync-user')).resolves.toBe('sync-user');
  });

  it('resolves JwtService from forRoot registration', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      issuer: 'jwt-module-tests',
      secret: 'for-root-secret',
    });

    container.register(...moduleProviders(moduleType));

    const jwtService = await container.resolve(JwtService);
    const token = await jwtService.sign({ sub: 'for-root-user' });

    await expect(jwtService.verify(token)).resolves.toMatchObject({
      subject: 'for-root-user',
    });
  });

  it('resolves compatible signer, verifier, and service copy tokens to the forRoot owners', async () => {
    class JwtServiceCopyB {}
    class JwtSignerCopyB {}
    class JwtVerifierCopyB {}

    defineFrameworkServiceIdentity(JwtServiceCopyB, {
      id: '@fluojs/jwt/JwtService',
      version: 1,
    });
    defineFrameworkServiceIdentity(JwtSignerCopyB, {
      id: '@fluojs/jwt/DefaultJwtSigner',
      version: 1,
    });
    defineFrameworkServiceIdentity(JwtVerifierCopyB, {
      id: '@fluojs/jwt/DefaultJwtVerifier',
      version: 1,
    });

    const container = new Container().register(
      ...moduleProviders(JwtModule.forRoot({
        algorithms: ['HS256'],
        issuer: 'jwt-compatible-copy-tests',
        secret: 'compatible-copy-secret',
      })),
    );
    const [service, signer, verifier, serviceCopy, signerCopy, verifierCopy] = await Promise.all([
      container.resolve(JwtService),
      container.resolve(DefaultJwtSigner),
      container.resolve(DefaultJwtVerifier),
      container.resolve(JwtServiceCopyB),
      container.resolve(JwtSignerCopyB),
      container.resolve(JwtVerifierCopyB),
    ]);
    const token = await service.sign({ sub: 'compatible-copy-user' });

    expect(serviceCopy).toBe(service);
    expect(signerCopy).toBe(signer);
    expect(verifierCopy).toBe(verifier);
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: 'compatible-copy-user',
    });
  });

  it('resolves query-isolated JWT service copies through the real module graph and preserves behavior', async () => {
    const signerCopyB = await import(`${new URL('./signing/signer.ts', import.meta.url).href}?module-copy=consumer`);
    const verifierCopyB = await import(`${new URL('./signing/verifier.ts', import.meta.url).href}?module-copy=consumer`);
    const serviceCopyB = await import(`${new URL('./service.ts', import.meta.url).href}?module-copy=consumer`);
    const refreshCopyB = await import(`${new URL('./refresh/refresh-token.ts', import.meta.url).href}?module-copy=consumer`);
    const COPY_B_SERVICES = Symbol('copy-b-jwt-services');

    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          issuer: 'jwt-query-isolated-copy-tests',
          refreshToken: {
            expiresInSeconds: 60,
            rotation: true,
            secret: 'query-isolated-refresh-secret',
            store: 'memory',
          },
          secret: 'query-isolated-access-secret',
        }),
      ],
      providers: [
        {
          provide: COPY_B_SERVICES,
          inject: [
            signerCopyB.DefaultJwtSigner,
            verifierCopyB.DefaultJwtVerifier,
            serviceCopyB.JwtService,
            refreshCopyB.RefreshTokenService,
          ],
          useFactory: (...dependencies: unknown[]) => dependencies,
        },
      ],
    })
    class AppModule {}

    const app = await FluoFactory.createApplicationContext(AppModule);

    try {
      const [injectedSigner, injectedVerifier, injectedService, injectedRefresh] =
        await app.container.resolve<unknown[]>(COPY_B_SERVICES);
      const ownerSigner = await app.container.resolve(DefaultJwtSigner);
      const ownerVerifier = await app.container.resolve(DefaultJwtVerifier);
      const ownerService = await app.container.resolve(JwtService);
      const ownerRefresh = await app.container.resolve(RefreshTokenService);
      const resolvedSigner = await app.container.resolve(signerCopyB.DefaultJwtSigner);
      const resolvedVerifier = await app.container.resolve(verifierCopyB.DefaultJwtVerifier);
      const resolvedService = await app.container.resolve(serviceCopyB.JwtService);
      const resolvedRefresh = await app.container.resolve(refreshCopyB.RefreshTokenService);

      expect(injectedSigner).toBe(ownerSigner);
      expect(injectedVerifier).toBe(ownerVerifier);
      expect(injectedService).toBe(ownerService);
      expect(injectedRefresh).toBe(ownerRefresh);
      expect(resolvedSigner).toBe(ownerSigner);
      expect(resolvedVerifier).toBe(ownerVerifier);
      expect(resolvedService).toBe(ownerService);
      expect(resolvedRefresh).toBe(ownerRefresh);

      const lowLevelToken = await ownerSigner.signAccessToken({ sub: 'low-level-copy-user' });
      await expect(ownerVerifier.verifyAccessToken(lowLevelToken)).resolves.toMatchObject({
        subject: 'low-level-copy-user',
      });

      const serviceToken = await ownerService.sign({ sub: 'service-copy-user' });
      await expect(ownerService.verify(serviceToken)).resolves.toMatchObject({
        subject: 'service-copy-user',
      });

      const refreshToken = await ownerRefresh.issueRefreshToken('refresh-copy-user');
      await expect(ownerVerifier.verifyRefreshToken(refreshToken)).resolves.toMatchObject({
        subject: 'refresh-copy-user',
      });

      const rotated = await ownerRefresh.rotateRefreshToken(refreshToken);
      await expect(ownerService.verify(rotated.accessToken)).resolves.toMatchObject({
        subject: 'refresh-copy-user',
      });
    } finally {
      await app.close();
    }
  });

  it('registers JwtService provider in module metadata', () => {
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      issuer: 'jwt-module-tests',
      secret: 'metadata-secret',
    });

    expect(moduleProviders(moduleType).map((provider) => providerToken(provider))).toContain(JwtService);
  });

  it('resolves injected async options and wires them into jwt providers', async () => {
    const JWT_SECRET = Symbol('jwt-secret');
    const capturedSecrets: string[] = [];

    const container = new Container();
    const moduleType = JwtModule.forRootAsync({
      inject: [JWT_SECRET],
      useFactory: async (...deps: unknown[]) => {
        const [secret] = deps;

        if (typeof secret !== 'string') {
          throw new Error('jwt secret token must resolve to a string.');
        }

        capturedSecrets.push(secret);
        await Promise.resolve();

        return {
          algorithms: ['HS256'],
          issuer: 'jwt-module-tests',
          secret,
        };
      },
    });

    container.register(
      { provide: JWT_SECRET as Token<string>, useValue: 'async-secret' },
      ...moduleProviders(moduleType),
      JwtRoundTripService,
    );
    const service = await container.resolve(JwtRoundTripService);

    expect(capturedSecrets).toEqual(['async-secret']);
    await expect(service.signAndVerify('async-user')).resolves.toBe('async-user');
  });

  it('supports async registration for advanced injected configuration', async () => {
    const JWT_SETTINGS = Symbol('jwt-settings');

    const container = new Container();
    const moduleType = JwtModule.forRootAsync({
      inject: [JWT_SETTINGS],
      useFactory: async (...deps: unknown[]) => {
        const [settings] = deps;

        if (
          typeof settings !== 'object'
          || settings === null
          || !("issuer" in settings)
          || !("secret" in settings)
          || typeof settings.issuer !== 'string'
          || typeof settings.secret !== 'string'
        ) {
          throw new Error('jwt settings token must resolve to issuer/secret strings.');
        }

        return {
          accessTokenTtlSeconds: 900,
          algorithms: ['HS256'],
          audience: 'advanced-async-clients',
          issuer: settings.issuer,
          secret: settings.secret,
        };
      },
    });

    container.register(
      {
        provide: JWT_SETTINGS as Token<{ issuer: string; secret: string }>,
        useValue: {
          issuer: 'advanced-async-issuer',
          secret: 'advanced-async-secret',
        },
      },
      ...moduleProviders(moduleType),
      JwtRoundTripService,
    );

    const service = await container.resolve(JwtRoundTripService);

    await expect(service.signAndVerify('advanced-async-user')).resolves.toBe('advanced-async-user');
  });

  it('propagates async option factory failures while resolving jwt providers', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRootAsync({
      useFactory: async () => {
        throw new Error('jwt async options failed');
      },
    });

    container.register(...moduleProviders(moduleType));

    await expect(container.resolve(DefaultJwtSigner)).rejects.toThrow('jwt async options failed');
  });

  it('rejects async refresh token service resolution when async options omit refreshToken', async () => {
    const app = await createJwtApplicationContext(JwtModule.forRootAsync({
      useFactory: async () => ({
        algorithms: ['HS256'],
        issuer: 'jwt-module-tests',
        secret: 'async-secret-without-refresh',
      }),
    }));

    try {
      await expect(app.container.resolve(RefreshTokenService)).rejects.toThrow(
        'JWT refresh token options are not configured.',
      );
    } finally {
      await app.close();
    }
  });

  it('exports refresh token service from async registration metadata to match sync registration parity', () => {
    const moduleType = JwtModule.forRootAsync({
      useFactory: async () => ({
        algorithms: ['HS256'],
        issuer: 'jwt-module-tests',
        secret: 'async-secret-without-refresh',
      }),
    });

    expect(moduleExports(moduleType)).toContain(RefreshTokenService);
    expect(moduleProviders(moduleType).map((provider) => providerToken(provider))).toContain(RefreshTokenService);
  });

  it('exports refresh token service from synchronous registration metadata when refresh options are omitted', () => {
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      issuer: 'jwt-module-tests',
      secret: 'sync-secret-without-refresh',
    });

    expect(moduleExports(moduleType)).toContain(RefreshTokenService);
    expect(moduleProviders(moduleType).map((provider) => providerToken(provider))).toContain(RefreshTokenService);
  });

  it('rejects sync refresh token service resolution when sync options omit refreshToken', async () => {
    const app = await createJwtApplicationContext(JwtModule.forRoot({
      algorithms: ['HS256'],
      issuer: 'jwt-module-tests',
      secret: 'sync-secret-without-refresh',
    }));

    try {
      await expect(app.container.resolve(RefreshTokenService)).rejects.toThrow(
        'JWT refresh token options are not configured.',
      );
    } finally {
      await app.close();
    }
  });
});
