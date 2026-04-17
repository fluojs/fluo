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

/**
 * Creates the provider set that wires passport options, strategy registry, and
 * the public {@link AuthGuard} into one module-friendly bundle.
 *
 * @remarks
 * Strategy names must be unique within the provided registration list. Prefer
 * {@link PassportModule.forRoot} for the canonical module-first API, and use
 * this helper when you need lower-level provider composition inside an
 * existing module definition.
 *
 * @example
 * ```ts
 * @Module({
 *   providers: [
 *     JwtStrategy,
 *     ...createPassportProviders(
 *       { defaultStrategy: 'jwt' },
 *       [{ name: 'jwt', token: JwtStrategy }],
 *     ),
 *   ],
 * })
 * export class AuthModule {}
 * ```
 *
 * @param options Module-level auth defaults such as `defaultStrategy`.
 * @param strategies Named strategy registrations exposed to `@UseAuth(...)` and the fallback default strategy.
 * @returns Providers for passport options, the strategy registry, and `AuthGuard`.
 * @throws {AuthStrategyResolutionError} When duplicate strategy names are registered.
 */
export function createPassportProviders(
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
      providers: createPassportProviders(options, strategies),
    });
  }
}
