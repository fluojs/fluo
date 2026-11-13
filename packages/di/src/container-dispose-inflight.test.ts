import { Inject } from '@fluojs/core';
import { describe, expect, it } from 'vitest';

import { Container } from './container.js';

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
});
