import { Inject, type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@konekti/core';
import { defineModuleMetadata } from '@konekti/core/internal';
import type { Container, Provider } from '@konekti/di';
import { RUNTIME_CONTAINER } from '@konekti/runtime/internal';

import { JwtConfigurationError } from './errors.js';
import { normalizeRefreshTokenOptions, RefreshTokenService } from './refresh/refresh-token.js';
import { JwtService } from './service.js';
import type { JwtVerifierOptions } from './types.js';
import { DefaultJwtSigner } from './signing/signer.js';
import { DefaultJwtVerifier, JWT_OPTIONS } from './signing/verifier.js';

type ModuleType = Constructor;

type JwtOptionsProvider =
  | {
      provide: typeof JWT_OPTIONS;
      scope: 'singleton';
      useValue: JwtVerifierOptions;
    }
  | {
      inject?: Token[];
      provide: typeof JWT_OPTIONS;
      scope: 'singleton';
      useFactory: (...deps: unknown[]) => MaybePromise<JwtVerifierOptions>;
    };

function resolveRefreshTokenOptions(value: unknown): NonNullable<JwtVerifierOptions['refreshToken']> {
  if (typeof value !== 'object' || value === null || !('refreshToken' in value)) {
    throw new JwtConfigurationError('JWT refresh token options are not configured.');
  }

  return normalizeRefreshTokenOptions((value as JwtVerifierOptions).refreshToken);
}

@Inject([JWT_OPTIONS, DefaultJwtSigner, DefaultJwtVerifier, RUNTIME_CONTAINER])
class AsyncRefreshTokenServiceRegistrar {
  private registered = false;

  constructor(
    private readonly options: JwtVerifierOptions,
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
    private readonly container: Container,
  ) {}

  onModuleInit(): void {
    if (!this.options.refreshToken || this.registered) {
      return;
    }

    const refreshTokenOptions = resolveRefreshTokenOptions(this.options);

    this.container.register({
      provide: RefreshTokenService,
      scope: 'transient',
      useFactory: () => new RefreshTokenService(refreshTokenOptions, this.signer, this.verifier),
    });
    this.registered = true;
  }
}

function createJwtModuleProviders(
  optionsProvider: JwtOptionsProvider,
  includeRefreshTokenService: boolean,
  refreshTokenServiceScope: 'singleton' | 'transient',
  deferRefreshTokenServiceRegistration = false,
): Provider[] {
  const providers: Provider[] = [optionsProvider, DefaultJwtVerifier, DefaultJwtSigner, JwtService];

  if (includeRefreshTokenService) {
    providers.push(
      deferRefreshTokenServiceRegistration
        ? AsyncRefreshTokenServiceRegistrar
        : {
            inject: [JWT_OPTIONS, DefaultJwtSigner, DefaultJwtVerifier],
            provide: RefreshTokenService,
            scope: refreshTokenServiceScope,
            useFactory: (...deps: unknown[]) => {
              const [options, signer, verifier] = deps;
              const refreshTokenOptions = resolveRefreshTokenOptions(options);

              return new RefreshTokenService(
                refreshTokenOptions,
                signer as DefaultJwtSigner,
                verifier as DefaultJwtVerifier,
              );
            },
          },
    );
  }

  return providers;
}

export function createJwtCoreProviders(options: JwtVerifierOptions): Provider[] {
  return createJwtModuleProviders({
    provide: JWT_OPTIONS,
    scope: 'singleton',
    useValue: options,
  }, Boolean(options.refreshToken), 'singleton');
}

export class JwtModule {
  static forRoot(options: JwtVerifierOptions): ModuleType {
    return this.createModule({
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useValue: options,
    }, Boolean(options.refreshToken), Boolean(options.refreshToken), 'singleton');
  }

  static forRootAsync(options: AsyncModuleOptions<JwtVerifierOptions>): ModuleType {
    return this.createModule({
      inject: options.inject,
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useFactory: options.useFactory,
    }, true, false, 'transient', true);
  }

  private static createModule(
    optionsProvider: JwtOptionsProvider,
    includeRefreshTokenProvider: boolean,
    includeRefreshTokenExport: boolean,
    refreshTokenServiceScope: 'singleton' | 'transient',
    deferRefreshTokenServiceRegistration = false,
  ): ModuleType {
    class JwtRuntimeModule {}

    defineModuleMetadata(JwtRuntimeModule, {
      exports: [JwtService, DefaultJwtVerifier, DefaultJwtSigner, ...(includeRefreshTokenExport ? [RefreshTokenService] : [])],
      providers: createJwtModuleProviders(
        optionsProvider,
        includeRefreshTokenProvider,
        refreshTokenServiceScope,
        deferRefreshTokenServiceRegistration,
      ),
    });

    return JwtRuntimeModule;
  }
}
