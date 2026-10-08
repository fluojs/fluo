import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { AuthStrategyResolutionError } from './errors.js';
import { AuthGuard } from './guard.js';
import { AUTH_STRATEGY_REGISTRY, PASSPORT_OPTIONS } from './internal-tokens.js';
import type {
  AuthStrategyRegistration,
  AuthStrategyRegistry,
  PassportModuleOptions,
} from './types.js';

function createStrategyRegistry(strategies: AuthStrategyRegistration[]): AuthStrategyRegistry {
  const registry: Record<string, AuthStrategyRegistration['token']> = Object.create(null);

  for (const strategy of strategies) {
    if (Object.hasOwn(registry, strategy.name)) {
      throw new AuthStrategyResolutionError(`Duplicate auth strategy registration for "${strategy.name}".`);
    }

    registry[strategy.name] = strategy.token;
  }

  return registry;
}

type PassportModuleType = ModuleType;

function createPassportModuleProviders(
  options: PassportModuleOptions = {},
  strategies: AuthStrategyRegistration[] = [],
): Provider[] {
  return [
    {
      provide: PASSPORT_OPTIONS,
      useValue: { ...options },
    },
    {
      provide: AUTH_STRATEGY_REGISTRY,
      useValue: createStrategyRegistry(strategies),
    },
    AuthGuard,
  ];
}

/**
 * Canonical module-first entrypoint for passport strategy wiring.
 */
export class PassportModule {
  /**
   * Registers passport options, the auth strategy registry, and {@link AuthGuard}.
   *
   * @param options Module-level auth defaults such as `defaultStrategy`.
   * @param strategies Named strategy registrations exposed to `@UseAuth(...)` and the fallback default strategy.
   * @returns A module definition that exports `AuthGuard` and keeps the strategy registry internal.
   * @throws {AuthStrategyResolutionError} When duplicate strategy names are registered.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { PassportModule } from '@fluojs/passport';
   *
   * @Module({
   *   imports: [
   *     PassportModule.forRoot(
   *       { defaultStrategy: 'jwt' },
   *       [{ name: 'jwt', token: JwtStrategy }],
   *     ),
   *   ],
   *   providers: [JwtStrategy],
   * })
   * export class AuthModule {}
   * ```
   */
  static forRoot(
    options: PassportModuleOptions = {},
    strategies: AuthStrategyRegistration[] = [],
  ): PassportModuleType {
    class PassportRootModule extends PassportModule {}

    return defineModule(PassportRootModule, {
      exports: [AuthGuard],
      global: options.global ?? false,
      providers: createPassportModuleProviders(options, strategies),
    });
  }
}

/** Canonical HTTP registration entrypoint sharing the legacy PassportModule class token. */
export { PassportModule as AuthModule };
