import type { Provider } from '@konekti/di';
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

/**
 * Creates the provider set that wires passport options, strategy registry, and
 * the public {@link AuthGuard} into one module-friendly bundle.
 *
 * @remarks
 * Strategy names must be unique within the provided registration list. The
 * returned providers are typically spread into a module's `providers` array.
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
