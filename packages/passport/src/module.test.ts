import { describe, expect, it } from 'vitest';

import { AuthStrategyResolutionError } from './errors.js';
import { createPassportProviders } from './module.js';
import type { AuthStrategy } from './types.js';

const AUTH_STRATEGY_REGISTRY_KEY = 'konekti.passport.strategy-registry';

describe('createPassportProviders', () => {
  it('keeps registry and module options tokens internal to package wiring', async () => {
    const passport = await import('./index.js');

    expect(passport).not.toHaveProperty('AUTH_STRATEGY_REGISTRY');
    expect(passport).not.toHaveProperty('PASSPORT_OPTIONS');
  });

  it('throws when duplicate strategy names are registered', () => {
    class FirstStrategy implements AuthStrategy {
      async authenticate() {
        return { claims: {}, subject: 'first' };
      }
    }

    class SecondStrategy implements AuthStrategy {
      async authenticate() {
        return { claims: {}, subject: 'second' };
      }
    }

    expect(() =>
      createPassportProviders(
        { defaultStrategy: 'jwt' },
        [
          { name: 'jwt', token: FirstStrategy },
          { name: 'jwt', token: SecondStrategy },
        ],
      ),
    ).toThrow(AuthStrategyResolutionError);
  });

  it('allows strategy names that shadow Object.prototype keys', () => {
    class ToStringStrategy implements AuthStrategy {
      async authenticate() {
        return { claims: {}, subject: 'to-string' };
      }
    }

    const providers = createPassportProviders(
      { defaultStrategy: 'toString' },
      [{ name: 'toString', token: ToStringStrategy }],
    );

    const strategyRegistryProvider = providers.find(
      (provider) =>
        typeof provider === 'object'
        && provider !== null
        && 'provide' in provider
        && typeof provider.provide === 'symbol'
        && Symbol.keyFor(provider.provide) === AUTH_STRATEGY_REGISTRY_KEY,
    );

    if (!strategyRegistryProvider || !('useValue' in strategyRegistryProvider)) {
      throw new Error('Expected strategy registry provider to be present.');
    }

    const registry = strategyRegistryProvider.useValue as Record<string, unknown>;

    expect(Object.hasOwn(registry, 'toString')).toBe(true);
    expect(registry.toString).toBe(ToStringStrategy);
  });

  it('throws when duplicate prototype-shadowing strategy names are registered', () => {
    class FirstStrategy implements AuthStrategy {
      async authenticate() {
        return { claims: {}, subject: 'first' };
      }
    }

    class SecondStrategy implements AuthStrategy {
      async authenticate() {
        return { claims: {}, subject: 'second' };
      }
    }

    expect(() =>
      createPassportProviders(
        { defaultStrategy: 'toString' },
        [
          { name: 'toString', token: FirstStrategy },
          { name: 'toString', token: SecondStrategy },
        ],
      ),
    ).toThrow(AuthStrategyResolutionError);
  });
});
