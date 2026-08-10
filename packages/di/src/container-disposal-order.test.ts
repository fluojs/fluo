import { describe, expect, it } from 'vitest';

import { Container } from './container.js';

describe('Container disposal order', () => {
  it('disposes cached providers in reverse creation order across single and multi-provider caches', async () => {
    // Given
    const dependencyToken = Symbol('dependencies');
    const events: string[] = [];

    class MultiProviderDependency {
      onDestroy(): void {
        events.push('dependency');
      }
    }

    class DependentService {
      constructor(readonly dependencies: readonly MultiProviderDependency[]) {}

      onDestroy(): void {
        events.push('dependent');
      }
    }

    const container = new Container().register(
      {
        multi: true,
        provide: dependencyToken,
        useClass: MultiProviderDependency,
      },
      {
        inject: [dependencyToken],
        provide: DependentService,
        useClass: DependentService,
      },
    );
    await container.resolve(DependentService);

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['dependent', 'dependency']);
  });
});
