import { Inject } from '@fluojs/core';
import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { resolveMultiContribution } from './internal.js';

function createDeferred(): { promise: Promise<void>; resolve(): void } {
  let settle = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return { promise, resolve: () => settle() };
}

describe('Container in-flight disposal (#4016)', () => {
  it.each([
    { scope: 'singleton', multi: false },
    { scope: 'singleton', multi: true },
    { scope: 'request', multi: false },
    { scope: 'request', multi: true },
  ] as const)('destroys late $scope dependencies before disposal settles (multi: $multi)', async ({ scope, multi }) => {
    const started = createDeferred();
    const gate = createDeferred();
    const destroyed: string[] = [];

    class Dep {
      onDestroy(): void {
        destroyed.push('Dep');
      }
    }

    @Inject('GATE', 'DEP')
    class Top {
      onDestroy(): void {
        destroyed.push('Top');
      }
    }

    const root = new Container().register(
      {
        provide: 'GATE',
        scope,
        useFactory: async () => {
          started.resolve();
          await gate.promise;
          return 1;
        },
      },
      { provide: 'DEP', useClass: Dep, scope, multi },
      { provide: Top, useClass: Top, scope },
    );
    const container = scope === 'request' ? root.createRequestScope() : root;
    const resolution = container.resolve(Top);
    await started.promise;

    const disposal = container.dispose();
    gate.resolve();
    await resolution;
    await disposal;

    expect(destroyed).toEqual(['Top', 'Dep']);
  }, 1_000);

  it.each([
    { scope: 'singleton', rootKind: 'transient' },
    { scope: 'singleton', rootKind: 'multi' },
    { scope: 'singleton', rootKind: 'contribution' },
    { scope: 'request', rootKind: 'transient' },
    { scope: 'request', rootKind: 'multi' },
    { scope: 'request', rootKind: 'contribution' },
  ] as const)('disposes late $scope dependencies of an uncached $rootKind root', async ({ scope, rootKind }) => {
    const started = createDeferred();
    const gate = createDeferred();
    const destroyed: string[] = [];

    class Leaf {
      onDestroy(): void {
        destroyed.push('Leaf');
      }
    }

    @Inject('LEAF')
    class Dep {
      onDestroy(): void {
        destroyed.push('Dep');
      }
    }

    @Inject('GATE', 'DEP')
    class Top {
      onDestroy(): void {
        destroyed.push('Top');
      }
    }

    const root = new Container().register(
      {
        provide: 'GATE',
        scope,
        useFactory: async () => {
          started.resolve();
          await gate.promise;
          return 1;
        },
      },
      { provide: 'LEAF', useClass: Leaf, scope },
      { provide: 'DEP', useClass: Dep, scope },
      { provide: Top, useClass: Top, scope: 'transient' },
      {
        provide: 'MULTI',
        multi: true,
        scope: 'transient',
        inject: ['GATE', 'DEP'],
        useFactory: (_gate, dep) => ({ dep }),
      },
    );
    const container = scope === 'request' ? root.createRequestScope() : root;
    const resolution = rootKind === 'transient'
      ? container.resolve(Top)
      : rootKind === 'multi'
        ? container.resolve('MULTI')
        : resolveMultiContribution(container, 'MULTI', 0);
    await started.promise;

    const disposal = container.dispose();
    gate.resolve();
    await resolution;
    await disposal;

    expect(destroyed).toEqual(['Dep', 'Leaf']);
  }, 1_000);

  it.each(['singleton', 'request'] as const)('root disposal waits for late $scope dependencies from a child', async (scope) => {
    const started = createDeferred();
    const gate = createDeferred();
    const destroyed: string[] = [];
    const root = new Container().register(
      {
        provide: 'GATE',
        useFactory: async () => {
          started.resolve();
          await gate.promise;
          return 1;
        },
      },
      {
        provide: 'DEP',
        scope,
        useFactory: () => ({ onDestroy: () => destroyed.push('Dep') }),
      },
      {
        provide: 'TOP',
        scope: 'transient',
        inject: ['GATE', 'DEP'],
        useFactory: (_gate, dep) => ({ dep }),
      },
    );
    const child = root.createRequestScope();
    const resolution = child.resolve('TOP');
    await started.promise;

    const disposal = root.dispose();
    gate.resolve();
    await resolution;
    await disposal;

    expect(destroyed).toEqual(['Dep']);
  }, 1_000);

  it.each(['singleton', 'transient'] as const)('disposes late dependencies when an in-flight $scope root rejects', async (scope) => {
    const started = createDeferred();
    const gate = createDeferred();
    const destroyed: string[] = [];
    const failure = new Error('Root failed after resolving dependencies');
    const container = new Container().register(
      {
        provide: 'GATE',
        useFactory: async () => {
          started.resolve();
          await gate.promise;
          return 1;
        },
      },
      {
        provide: 'DEP',
        useFactory: () => ({ onDestroy: () => destroyed.push('Dep') }),
      },
      {
        provide: 'TOP',
        scope,
        inject: ['GATE', 'DEP'],
        useFactory: () => { throw failure; },
      },
    );
    const resolution = expect(container.resolve('TOP')).rejects.toBe(failure);
    await started.promise;

    const disposal = container.dispose();
    const settlement = scope === 'singleton'
      ? expect(disposal).rejects.toBe(failure)
      : expect(disposal).resolves.toBeUndefined();
    gate.resolve();
    await resolution;
    await settlement;

    expect(destroyed).toEqual(['Dep']);
  }, 1_000);
});
