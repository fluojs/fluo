import { type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@konekti/core';
import { defineModuleMetadata } from '@konekti/core/internal';
import type { Provider } from '@konekti/di';

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

function createJwtModuleProviders(
  optionsProvider: JwtOptionsProvider,
  includeRefreshTokenService: boolean,
  refreshTokenServiceScope: 'singleton' | 'transient',
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
    }, Boolean(options.refreshToken), 'singleton');
  }

  static forRootAsync(options: AsyncModuleOptions<JwtVerifierOptions>): ModuleType {
    return this.createModule({
      inject: options.inject,
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useFactory: options.useFactory,
    }, true, 'transient');
  }

  private static createModule(
    optionsProvider: JwtOptionsProvider,
    includeRefreshTokenService: boolean,
    refreshTokenServiceScope: 'singleton' | 'transient',
  ): ModuleType {
    class JwtRuntimeModule {}

    defineModuleMetadata(JwtRuntimeModule, {
      exports: [JwtService, DefaultJwtVerifier, DefaultJwtSigner, ...(includeRefreshTokenService ? [RefreshTokenService] : [])],
      providers: createJwtModuleProviders(optionsProvider, includeRefreshTokenService, refreshTokenServiceScope),
    });

    return JwtRuntimeModule;
  }
}
