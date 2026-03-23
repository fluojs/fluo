import { describe, expect, it } from 'vitest';

import { AuthStrategyResolutionError } from './errors.js';
import { createPassportProviders } from './module.js';
import type { AuthStrategy } from './types.js';

describe('createPassportProviders', () => {
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
});
