import { describe, expect, it } from 'vitest';

import { Inject, getClassDiMetadata, getModuleMetadata, type Constructor, type Token } from '@konekti/core';
import { Container, type Provider } from '@konekti/di';

import { JwtModule } from './module.js';
import { type RefreshTokenRecord, type RefreshTokenStore, RefreshTokenService } from './refresh-token.js';
import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signer.js';
import { DefaultJwtVerifier } from './verifier.js';

class NoopRefreshTokenStore implements RefreshTokenStore {
  async save(_: RefreshTokenRecord): Promise<void> {}

  async find(_: string): Promise<RefreshTokenRecord | undefined> {
    return undefined;
  }

  async revoke(_: string): Promise<void> {}

  async revokeBySubject(_: string): Promise<void> {}

  async consume(): Promise<'consumed' | 'already_used' | 'expired' | 'not_found' | 'mismatch'> {
    return 'not_found';
  }
}

@Inject([DefaultJwtSigner, DefaultJwtVerifier])
class JwtRoundTripService {
  constructor(
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {}

  async signAndVerify(subject: string): Promise<string> {
    const token = await this.signer.signAccessToken({ sub: subject });
    const principal = await this.verifier.verifyAccessToken(token);

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

function providerScope(provider: Provider): 'singleton' | 'request' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useValue' in provider) {
    return 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? 'singleton';
  }

  return 'singleton';
}

function providerToken(provider: Provider): Token {
  if (typeof provider === 'function') {
    return provider;
  }

  return provider.provide;
}

async function resolveSingletonProviders(container: Container, providers: Provider[]): Promise<void> {
  for (const provider of providers) {
    if (providerScope(provider) !== 'singleton') {
      continue;
    }

    await container.resolve(providerToken(provider));
  }
}

describe('JwtModule', () => {
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

  it('supports NestJS-style register alias and resolves JwtService', async () => {
    const container = new Container();
    const moduleType = JwtModule.register({
      algorithms: ['HS256'],
      issuer: 'jwt-module-tests',
      secret: 'register-secret',
    });

    container.register(...moduleProviders(moduleType));

    const jwtService = await container.resolve(JwtService);
    const token = await jwtService.sign({ sub: 'register-user' });

    await expect(jwtService.verify<{ sub?: string }>(token)).resolves.toMatchObject({
      sub: 'register-user',
    });
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

  it('does not fail singleton provider resolution when async options omit refreshToken', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRootAsync({
      useFactory: async () => ({
        algorithms: ['HS256'],
        issuer: 'jwt-module-tests',
        secret: 'async-secret-without-refresh',
      }),
    });

    const providers = moduleProviders(moduleType);

    container.register(...providers);

    await expect(resolveSingletonProviders(container, providers)).resolves.toBeUndefined();
  });

  it('resolves refresh token service for async options when refreshToken is configured', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRootAsync({
      useFactory: async () => ({
        algorithms: ['HS256'],
        refreshToken: {
          expiresInSeconds: 60,
          rotation: true,
          secret: 'refresh-secret',
          store: new NoopRefreshTokenStore(),
        },
        secret: 'jwt-secret',
      }),
    });

    container.register(...moduleProviders(moduleType));

    await expect(container.resolve(RefreshTokenService)).resolves.toBeInstanceOf(RefreshTokenService);
  });

  it('registers refresh token service when refresh options are provided', async () => {
    const container = new Container();
    const moduleType = JwtModule.forRoot({
      algorithms: ['HS256'],
      refreshToken: {
        expiresInSeconds: 60,
        rotation: true,
        secret: 'refresh-secret',
        store: new NoopRefreshTokenStore(),
      },
      secret: 'jwt-secret',
    });

    container.register(...moduleProviders(moduleType));
    await expect(container.resolve(RefreshTokenService)).resolves.toBeInstanceOf(RefreshTokenService);
  });
});
