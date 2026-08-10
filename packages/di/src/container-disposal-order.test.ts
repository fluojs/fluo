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

  it('releases stale request-cache materializations after ancestor override disposal settles', async () => {
    // Given
    const serviceToken = Symbol('service');
    const events: string[] = [];

    class OriginalService {
      onDestroy(): void {
        events.push('original:destroy');
      }
    }

    class ReplacementService {}

    const root = new Container().register({
      provide: serviceToken,
      scope: 'request',
      useClass: OriginalService,
    });
    const requestContainer = root.createRequestScope();
    await requestContainer.resolve(serviceToken);

    const requestCache = Reflect.get(requestContainer, 'requestCache');
    if (!(requestCache instanceof Map)) {
      expect.unreachable('expected the request cache to be materialized');
    }

    const stalePromise = requestCache.get(serviceToken);
    if (!stalePromise) {
      expect.unreachable('expected the original service promise to be cached');
    }

    // When
    root.override({ provide: serviceToken, scope: 'request', useClass: ReplacementService });
    await requestContainer.resolve(serviceToken);

    // Then
    const materializedCachePromises = Reflect.get(requestContainer, 'materializedCachePromises');
    if (!Array.isArray(materializedCachePromises)) {
      expect.unreachable('expected the materialization ledger to be an array');
    }

    expect({
      events,
      retainsStalePromise: materializedCachePromises.includes(stalePromise),
    }).toEqual({
      events: ['original:destroy'],
      retainsStalePromise: false,
    });
  });
});
