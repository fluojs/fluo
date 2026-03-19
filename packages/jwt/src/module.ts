import { defineModuleMetadata, type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@konekti/core';
import type { Provider } from '@konekti/di';

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

function createJwtModuleProviders(optionsProvider: JwtOptionsProvider): Provider[] {
  return [optionsProvider, DefaultJwtVerifier, DefaultJwtSigner];
}

export function createJwtCoreProviders(options: JwtVerifierOptions): Provider[] {
  return createJwtModuleProviders({
    provide: JWT_OPTIONS,
    scope: 'singleton',
    useValue: options,
  });
}

export class JwtModule {
  static forRoot(options: JwtVerifierOptions): ModuleType {
    return this.createModule({
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useValue: options,
    });
  }

  static forRootAsync(options: AsyncModuleOptions<JwtVerifierOptions>): ModuleType {
    return this.createModule({
      inject: options.inject,
      provide: JWT_OPTIONS,
      scope: 'singleton',
      useFactory: options.useFactory,
    });
  }

  private static createModule(optionsProvider: JwtOptionsProvider): ModuleType {
    class JwtRuntimeModule {}

    defineModuleMetadata(JwtRuntimeModule, {
      exports: [DefaultJwtVerifier, DefaultJwtSigner],
      providers: createJwtModuleProviders(optionsProvider),
    });

    return JwtRuntimeModule;
  }
}
