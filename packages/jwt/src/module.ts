import { Inject, type AsyncModuleOptions, type Constructor, type InjectionToken, type MaybePromise } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';
import type { Provider } from '@fluojs/di';

import { JwtConfigurationError } from './errors.js';
import { normalizeRefreshTokenOptions, RefreshTokenService } from './refresh/refresh-token.js';
import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signing/signer.js';
import { DefaultJwtVerifier, JWT_OPTIONS } from './signing/verifier.js';
import type { JwtVerifierOptions } from './types.js';

type ModuleType = Constructor;

type JwtOptionsProvider =
  | {
      provide: typeof JWT_OPTIONS;
      scope: 'singleton';
      useValue: JwtVerifierOptions;
    }
  | {
      inject?: InjectionToken[];
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
  private refreshTokenService: RefreshTokenService | undefined;

  constructor(
    private readonly options: JwtVerifierOptions,
    private readonly signer: DefaultJwtSigner,
    private readonly verifier: DefaultJwtVerifier,
  ) {}

  onModuleInit(): void {
    if (!this.options.refreshToken) {
      return;
    }

    resolveRefreshTokenOptions(this.options);
  }

  getRefreshTokenService(): RefreshTokenService {
    this.refreshTokenService ??= new RefreshTokenService(
      resolveRefreshTokenOptions(this.options),
      this.signer,
      this.verifier,
    );

    return this.refreshTokenService;
  }
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
    }, true, true, options.refreshToken ? 'singleton' : 'transient', false, options.global ?? false);
  }

  static forRootAsync(options: AsyncModuleOptions<JwtVerifierOptions> & { global?: boolean }): ModuleType {
    return this.createModule({
      inject: options.inject,
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useFactory: options.useFactory,
    }, true, true, 'transient', true, options.global ?? false);
  }

  private static createModule(
    optionsProvider: JwtOptionsProvider,
    includeRefreshTokenProvider: boolean,
    includeRefreshTokenExport: boolean,
    refreshTokenServiceScope: 'singleton' | 'transient',
    deferRefreshTokenServiceRegistration = false,
    global = false,
  ): ModuleType {
    class JwtRuntimeModule {}

    defineModuleMetadata(JwtRuntimeModule, {
      exports: [JwtService, DefaultJwtVerifier, DefaultJwtSigner, ...(includeRefreshTokenExport ? [RefreshTokenService] : [])],
      global,
      providers: this.createProviders(
        optionsProvider,
        includeRefreshTokenProvider,
        refreshTokenServiceScope,
        deferRefreshTokenServiceRegistration,
      ),
    });

    return JwtRuntimeModule;
  }

  private static createProviders(
    optionsProvider: JwtOptionsProvider,
    includeRefreshTokenService: boolean,
    refreshTokenServiceScope: 'singleton' | 'transient',
    deferRefreshTokenServiceRegistration: boolean,
  ): Provider[] {
    const providers: Provider[] = [optionsProvider, DefaultJwtVerifier, DefaultJwtSigner, JwtService];

    if (includeRefreshTokenService) {
      if (deferRefreshTokenServiceRegistration) {
        providers.push(AsyncRefreshTokenServiceRegistrar);
        providers.push({
          inject: [AsyncRefreshTokenServiceRegistrar],
          provide: RefreshTokenService,
          scope: refreshTokenServiceScope,
          useFactory: (...deps: unknown[]) => {
            const [registrar] = deps;

            if (!(registrar instanceof AsyncRefreshTokenServiceRegistrar)) {
              throw new JwtConfigurationError('JWT refresh token service registrar is not configured.');
            }

            return registrar.getRefreshTokenService();
          },
        });
      } else {
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
      }
    }

    return providers;
  }
}
