import type { Provider } from '@konekti/di';
import { AuthStrategyResolutionError } from './errors.js';
import { AuthGuard } from './guard.js';
import {
  AUTH_STRATEGY_REGISTRY,
  PASSPORT_OPTIONS,
  type AuthStrategyRegistration,
  type AuthStrategyRegistry,
  type PassportModuleOptions,
} from './types.js';

function createStrategyRegistry(strategies: AuthStrategyRegistration[]): AuthStrategyRegistry {
  const registry: Record<string, AuthStrategyRegistration['token']> = Object.create(null);

  for (const strategy of strategies) {
    if (Object.prototype.hasOwnProperty.call(registry, strategy.name)) {
      throw new AuthStrategyResolutionError(`Duplicate auth strategy registration for "${strategy.name}".`);
    }

    registry[strategy.name] = strategy.token;
  }

  return registry;
}

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
