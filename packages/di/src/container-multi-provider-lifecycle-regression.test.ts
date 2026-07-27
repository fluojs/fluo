import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { CircularDependencyError } from './errors.js';
import { Scope } from './types.js';

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let settle = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return { promise, resolve: () => settle() };
}

const cachedMultiProviderScopes = [
  { label: 'singleton', scope: Scope.DEFAULT },
  { label: 'request-scoped', scope: Scope.REQUEST },
] as const;

describe.each(cachedMultiProviderScopes)('$label multi-provider lifecycle', ({ scope }) => {
  it('rejects a cycle through a pending cached resolution', async () => {
    // Given
    const collectionToken = Symbol(`${scope}-collection`);
    const dependentToken = Symbol(`${scope}-dependent`);
    const collectionGateToken = Symbol(`${scope}-collection-gate`);
    const dependentGateToken = Symbol(`${scope}-dependent-gate`);
    let startedFactories = 0;
    const factoriesStarted = createDeferred();
    const factoryRelease = createDeferred();
    const waitForFactoryPeer = async (): Promise<void> => {
      startedFactories += 1;

      if (startedFactories === 2) {
        factoriesStarted.resolve();
      }

      await factoryRelease.promise;
    };
    const root = new Container().register(
      {
        provide: collectionGateToken,
        scope,
        useFactory: waitForFactoryPeer,
      },
      {
        provide: dependentGateToken,
        scope,
        useFactory: waitForFactoryPeer,
      },
      {
        inject: [collectionGateToken, dependentToken],
        multi: true,
        provide: collectionToken,
        scope,
        useFactory: (_gate: unknown, dependent: unknown) => dependent,
      },
      {
        inject: [dependentGateToken, collectionToken],
        provide: dependentToken,
        scope,
        useFactory: (_gate: unknown, collection: unknown) => collection,
      },
    );
    const container = scope === Scope.REQUEST ? root.createRequestScope() : root;

    // When
    const resolutions = Promise.all([
      container.resolve(collectionToken),
      container.resolve(dependentToken),
    ]);
    await factoriesStarted.promise;
    factoryRelease.resolve();

    // Then
    await expect(resolutions).rejects.toThrow(CircularDependencyError);
  }, 1_000);
});

describe('cached multi-provider wait edges', () => {
  it('shares an acyclic pending resolution and removes its wait edge after settlement', async () => {
    // Given
    const dependencyToken = Symbol('settling-multi-dependency');
    const firstToken = Symbol('acyclic-multi-first');
    const secondToken = Symbol('acyclic-multi-second');
    const firstGateToken = Symbol('acyclic-multi-first-gate');
    const firstGateStartedToken = Symbol('acyclic-multi-first-gate-started');
    let dependencyFactoryCalls = 0;
    const dependencyStarted = createDeferred();
    const dependencyRelease = createDeferred();
    const firstGateStarted = createDeferred();
    const firstGateRelease = createDeferred();
    const container = new Container().register(
      {
        multi: true,
        provide: dependencyToken,
        useFactory: async () => {
          dependencyFactoryCalls += 1;
          dependencyStarted.resolve();
          await dependencyRelease.promise;
          return 'dependency';
        },
      },
      {
        provide: firstGateToken,
        useFactory: async () => {
          firstGateStarted.resolve();
          await firstGateRelease.promise;
          return 'first-gate';
        },
      },
      {
        provide: firstGateStartedToken,
        useFactory: async () => {
          await firstGateStarted.promise;
          return 'first-gate-started';
        },
      },
      {
        inject: [dependencyToken, firstGateToken],
        provide: firstToken,
        useFactory: () => 'first',
      },
      {
        inject: [dependencyToken, firstGateStartedToken, firstToken],
        provide: secondToken,
        useFactory: () => 'second',
      },
    );

    // When
    const secondResolution = container.resolve(secondToken);
    await dependencyStarted.promise;
    const resolutions = Promise.all([
      container.resolve(firstToken),
      secondResolution,
    ]);
    const assertion = expect(resolutions).resolves.toEqual(['first', 'second']);
    dependencyRelease.resolve();
    await firstGateStarted.promise;
    firstGateRelease.resolve();

    // Then
    await assertion;
    expect(dependencyFactoryCalls).toBe(1);
  }, 1_000);
});
