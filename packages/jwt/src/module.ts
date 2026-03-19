import { defineModuleMetadata, type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@konekti/core';
import type { Provider } from '@konekti/di';

import { JwtConfigurationError } from './errors.js';
import { RefreshTokenService } from './refresh-token.js';
import type { JwtVerifierOptions } from './types.js';
import { DefaultJwtSigner } from './signer.js';
import { DefaultJwtVerifier, JWT_OPTIONS } from './verifier.js';

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

function hasRefreshTokenOptions(
  value: unknown,
): value is JwtVerifierOptions & { refreshToken: NonNullable<JwtVerifierOptions['refreshToken']> } {
  return typeof value === 'object' && value !== null && 'refreshToken' in value && Boolean(value.refreshToken);
}

function createJwtModuleProviders(optionsProvider: JwtOptionsProvider, includeRefreshTokenService: boolean): Provider[] {
  const providers: Provider[] = [optionsProvider, DefaultJwtVerifier, DefaultJwtSigner];

  if (includeRefreshTokenService) {
    providers.push({
      inject: [JWT_OPTIONS, DefaultJwtSigner, DefaultJwtVerifier],
      provide: RefreshTokenService,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => {
        const [options, signer, verifier] = deps;

        if (!hasRefreshTokenOptions(options)) {
          throw new JwtConfigurationError('JWT refresh token options are not configured.');
        }

        return new RefreshTokenService(
          options.refreshToken,
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
  }, Boolean(options.refreshToken));
}

export class JwtModule {
  static forRoot(options: JwtVerifierOptions): ModuleType {
    return this.createModule({
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useValue: options,
    }, Boolean(options.refreshToken));
  }

  static forRootAsync(options: AsyncModuleOptions<JwtVerifierOptions>): ModuleType {
    return this.createModule({
      inject: options.inject,
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useFactory: options.useFactory,
    }, true);
  }

  private static createModule(optionsProvider: JwtOptionsProvider, includeRefreshTokenService: boolean): ModuleType {
    class JwtRuntimeModule {}

    defineModuleMetadata(JwtRuntimeModule, {
      exports: [DefaultJwtVerifier, DefaultJwtSigner, ...(includeRefreshTokenService ? [RefreshTokenService] : [])],
      providers: createJwtModuleProviders(optionsProvider, includeRefreshTokenService),
    });

    return JwtRuntimeModule;
  }
}
