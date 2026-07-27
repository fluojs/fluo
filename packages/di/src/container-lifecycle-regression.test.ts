import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { CircularDependencyError, ScopeMismatchError } from './errors.js';
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

describe('Container lifecycle regressions', () => {
  it('rejects a cycle between pending singleton resolutions', async () => {
    // Given
    const firstToken = Symbol('first-singleton');
    const secondToken = Symbol('second-singleton');
    const firstGateToken = Symbol('first-gate');
    const secondGateToken = Symbol('second-gate');
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
    const container = new Container().register(
      {
        provide: firstGateToken,
        useFactory: waitForFactoryPeer,
      },
      {
        provide: secondGateToken,
        useFactory: waitForFactoryPeer,
      },
      {
        provide: firstToken,
        inject: [firstGateToken, secondToken],
        useFactory: (_gate: unknown, second: unknown) => second,
      },
      {
        provide: secondToken,
        inject: [secondGateToken, firstToken],
        useFactory: (_gate: unknown, first: unknown) => first,
      },
    );

    // When
    const resolutions = Promise.all([
      container.resolve(firstToken),
      container.resolve(secondToken),
    ]);
    await factoriesStarted.promise;
    factoryRelease.resolve();

    // Then
    await expect(resolutions).rejects.toThrow(CircularDependencyError);
  }, 1_000);

  it('rejects a cycle between pending request-scoped resolutions', async () => {
    // Given
    const firstToken = Symbol('first-request');
    const secondToken = Symbol('second-request');
    const firstGateToken = Symbol('first-request-gate');
    const secondGateToken = Symbol('second-request-gate');
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
        provide: firstGateToken,
        scope: Scope.REQUEST,
        useFactory: waitForFactoryPeer,
      },
      {
        provide: secondGateToken,
        scope: Scope.REQUEST,
        useFactory: waitForFactoryPeer,
      },
      {
        provide: firstToken,
        inject: [firstGateToken, secondToken],
        scope: Scope.REQUEST,
        useFactory: (_gate: unknown, second: unknown) => second,
      },
      {
        provide: secondToken,
        inject: [secondGateToken, firstToken],
        scope: Scope.REQUEST,
        useFactory: (_gate: unknown, first: unknown) => first,
      },
    );
    const requestScope = root.createRequestScope();

    // When
    const resolutions = Promise.all([
      requestScope.resolve(firstToken),
      requestScope.resolve(secondToken),
    ]);
    await factoriesStarted.promise;
    factoryRelease.resolve();

    // Then
    await expect(resolutions).rejects.toThrow(CircularDependencyError);
  }, 1_000);

  it('rejects a deep cycle between interleaved pending singleton resolutions', async () => {
    // Given
    const firstToken = Symbol('first-deep-singleton');
    const secondToken = Symbol('second-deep-singleton');
    const thirdToken = Symbol('third-deep-singleton');
    const firstGateToken = Symbol('first-deep-gate');
    const secondGateToken = Symbol('second-deep-gate');
    const thirdGateToken = Symbol('third-deep-gate');
    let startedFactories = 0;
    const factoriesStarted = createDeferred();
    const firstGate = createDeferred();
    const secondGate = createDeferred();
    const thirdGate = createDeferred();
    const createGate = (gate: Deferred): (() => Promise<void>) => async () => {
      startedFactories += 1;

      if (startedFactories === 3) {
        factoriesStarted.resolve();
      }

      await gate.promise;
    };
    const flushMicrotasks = async (): Promise<void> => {
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    };
    const container = new Container().register(
      { provide: firstGateToken, useFactory: createGate(firstGate) },
      { provide: secondGateToken, useFactory: createGate(secondGate) },
      { provide: thirdGateToken, useFactory: createGate(thirdGate) },
      { provide: firstToken, inject: [firstGateToken, secondToken], useFactory: (_gate: unknown, second: unknown) => second },
      { provide: secondToken, inject: [secondGateToken, thirdToken], useFactory: (_gate: unknown, third: unknown) => third },
      { provide: thirdToken, inject: [thirdGateToken, firstToken], useFactory: (_gate: unknown, first: unknown) => first },
    );

    // When
    const resolutions = Promise.all([
      container.resolve(firstToken),
      container.resolve(secondToken),
      container.resolve(thirdToken),
    ]);
    await factoriesStarted.promise;
    firstGate.resolve();
    await flushMicrotasks();
    thirdGate.resolve();
    await flushMicrotasks();
    secondGate.resolve();

    // Then
    await expect(resolutions).rejects.toThrow(CircularDependencyError);
  }, 1_000);

  it('does not report a cycle after an awaited pending dependency settles', async () => {
    // Given
    const dependencyToken = Symbol('settling-dependency');
    const firstToken = Symbol('acyclic-first');
    const secondToken = Symbol('acyclic-second');
    const firstGateToken = Symbol('acyclic-first-gate');
    const firstGateStartedToken = Symbol('acyclic-first-gate-started');
    const dependencyStarted = createDeferred();
    const dependencyRelease = createDeferred();
    const firstGateStarted = createDeferred();
    const firstGateRelease = createDeferred();
    const container = new Container().register(
      {
        provide: dependencyToken,
        useFactory: async () => {
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
        provide: firstToken,
        inject: [dependencyToken, firstGateToken],
        useFactory: () => 'first',
      },
      {
        provide: secondToken,
        inject: [dependencyToken, firstGateStartedToken, firstToken],
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
  }, 1_000);

  it('shares a pending request-scoped resolution when no cycle exists', async () => {
    // Given
    const token = Symbol('shared-pending-request');
    const instance = { value: 'request' };
    const factoryStarted = createDeferred();
    const factoryRelease = createDeferred();
    const requestScope = new Container()
      .register({
        provide: token,
        scope: Scope.REQUEST,
        useFactory: async () => {
          factoryStarted.resolve();
          await factoryRelease.promise;
          return instance;
        },
      })
      .createRequestScope();

    // When
    const firstResolution = requestScope.resolve(token);
    await factoryStarted.promise;
    const secondResolution = requestScope.resolve(token);
    factoryRelease.resolve();
    const [first, second] = await Promise.all([firstResolution, secondResolution]);

    // Then
    expect(first).toBe(instance);
    expect(second).toBe(first);
  });

  it('rejects a request-scope override that introduces a singleton', () => {
    // Given
    const token = Symbol('request-only-singleton');
    const requestScope = new Container().createRequestScope();

    // When
    const overrideSingleton = () => requestScope.override({ provide: token, useValue: 'request-only' });

    // Then
    expect(overrideSingleton).toThrow(ScopeMismatchError);
  });

  it('rejects request-scope multi overrides that introduce singletons', () => {
    // Given
    const token = Symbol('request-only-singleton-collection');
    const requestScope = new Container().createRequestScope();

    // When
    const overrideSingletons = () => requestScope.override(
      { multi: true, provide: token, useValue: 'first' },
      { multi: true, provide: token, useValue: 'second' },
    );

    // Then
    expect(overrideSingletons).toThrow(ScopeMismatchError);
  });
});
