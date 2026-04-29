import { Inject, type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';
import type { Provider } from '@fluojs/di';

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

@Inject(JWT_OPTIONS, DefaultJwtSigner, DefaultJwtVerifier)
class AsyncRefreshTokenServiceRegistrar {
  constructor(
    private readonly options: JwtVerifierOptions,
    _signer: DefaultJwtSigner,
    _verifier: DefaultJwtVerifier,
  ) {}

  onModuleInit(): void {
    if (!this.options.refreshToken) {
      return;
    }

    resolveRefreshTokenOptions(this.options);
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
    providers.push({
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
    });

    if (deferRefreshTokenServiceRegistration) {
      providers.push(AsyncRefreshTokenServiceRegistrar);
    }
  }

  return providers;
}

/**
 * Registers JWT services and optional refresh-token support for an application module.
 */
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
    }, true, true, 'transient', true);
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
      providers: createJwtModuleProviders(optionsProvider, includeRefreshTokenProvider, refreshTokenServiceScope, deferRefreshTokenServiceRegistration),
    });

    return JwtRuntimeModule;
  }
}
