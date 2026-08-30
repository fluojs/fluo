import { describe, expect, it, vi } from 'vitest';

import { Container } from './container.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface DisposalAttemptGate {
  readonly release: Promise<void>;
  readonly started: () => void;
}

interface DisposalProbe {
  readonly attempts: number;
  readonly onDestroy: () => Promise<void>;
}

function createDeferred(): Deferred {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function createDisposalProbe(
  failures: readonly (Error | undefined)[],
  gate?: DisposalAttemptGate,
): DisposalProbe {
  let attempts = 0;

  return {
    get attempts() {
      return attempts;
    },
    onDestroy: async () => {
      attempts += 1;
      gate?.started();

      if (gate) {
        await gate.release;
      }

      const failure = failures[attempts - 1];

      if (failure) {
        throw failure;
      }
    },
  };
}

describe('Container disposal ownership', () => {
  it('does not let root disposal retry a directly disposed failed child while root cleanup runs', async () => {
    // Given
    const childToken = Symbol('direct-failed-child');
    const rootToken = Symbol('direct-failed-child-root');
    const childFailure = new Error('direct child failed');
    const child = createDisposalProbe([childFailure]);
    const rootDisposable = { onDestroy: vi.fn() };
    const root = new Container().register(
      { provide: childToken, scope: 'request', useFactory: () => child },
      { provide: rootToken, useValue: rootDisposable },
    );
    const childScope = root.createRequestScope();
    await childScope.resolve(childToken);
    await root.resolve(rootToken);

    // When
    await expect(childScope.dispose()).rejects.toBe(childFailure);
    await root.dispose();

    // Then
    expect(child.attempts).toBe(1);
    expect(rootDisposable.onDestroy).toHaveBeenCalledOnce();
  });

  it('lets a retained caller retry a detached failed child without replaying successful siblings', async () => {
    // Given
    const failingToken = Symbol('retained-failed-child');
    const successfulToken = Symbol('retained-successful-child');
    const childFailure = new Error('retained child failed');
    const failingDisposable = createDisposalProbe([childFailure, undefined]);
    const successfulDisposable = { onDestroy: vi.fn() };
    const root = new Container().register(
      { provide: failingToken, scope: 'request', useFactory: () => failingDisposable },
      { provide: successfulToken, scope: 'request', useFactory: () => successfulDisposable },
    );
    const childScope = root.createRequestScope();
    await childScope.resolve(failingToken);
    await childScope.resolve(successfulToken);

    // When
    await expect(childScope.dispose()).rejects.toBe(childFailure);
    await childScope.dispose();

    // Then
    expect(failingDisposable.attempts).toBe(2);
    expect(successfulDisposable.onDestroy).toHaveBeenCalledOnce();
  });

  it('keeps direct-first ownership when parent disposal joins the active attempt', async () => {
    // Given
    const childToken = Symbol('direct-first-child');
    const rootToken = Symbol('direct-first-root');
    const childFailure = new Error('direct-first child failed');
    const releaseAttempt = createDeferred();
    const attemptStarted = createDeferred();
    const child = createDisposalProbe([childFailure, undefined], {
      release: releaseAttempt.promise,
      started: attemptStarted.resolve,
    });
    const rootDisposable = { onDestroy: vi.fn() };
    const root = new Container().register(
      { provide: childToken, scope: 'request', useFactory: () => child },
      { provide: rootToken, useValue: rootDisposable },
    );
    const childScope = root.createRequestScope();
    await childScope.resolve(childToken);
    await root.resolve(rootToken);

    // When
    const directDispose = childScope.dispose();
    await attemptStarted.promise;
    const parentDispose = root.dispose();
    let parentSettled = false;
    const observeParentSettlement = parentDispose.then(
      () => {
        parentSettled = true;
      },
      () => {
        parentSettled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Then
    expect(child.attempts).toBe(1);
    expect(parentSettled).toBe(false);

    // When
    releaseAttempt.resolve();
    const firstResults = await Promise.allSettled([directDispose, parentDispose]);
    await observeParentSettlement;
    await root.dispose();

    // Then
    expect(firstResults.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(firstResults.map((result) => result.status === 'rejected' ? result.reason : undefined)).toEqual([
      childFailure,
      childFailure,
    ]);
    expect(child.attempts).toBe(1);
    expect(rootDisposable.onDestroy).toHaveBeenCalledOnce();
  });

  it('keeps parent-first ownership when direct disposal joins the active attempt', async () => {
    // Given
    const childToken = Symbol('parent-first-child');
    const rootToken = Symbol('parent-first-root');
    const childFailure = new Error('parent-first child failed');
    const releaseAttempt = createDeferred();
    const attemptStarted = createDeferred();
    const child = createDisposalProbe([childFailure, undefined], {
      release: releaseAttempt.promise,
      started: attemptStarted.resolve,
    });
    const rootDisposable = { onDestroy: vi.fn() };
    const root = new Container().register(
      { provide: childToken, scope: 'request', useFactory: () => child },
      { provide: rootToken, useValue: rootDisposable },
    );
    const childScope = root.createRequestScope();
    await childScope.resolve(childToken);
    await root.resolve(rootToken);

    // When
    const parentDispose = root.dispose();
    await attemptStarted.promise;
    const directDispose = childScope.dispose();

    // Then
    expect(child.attempts).toBe(1);

    // When
    releaseAttempt.resolve();
    const firstResults = await Promise.allSettled([parentDispose, directDispose]);
    await root.dispose();

    // Then
    expect(firstResults.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(firstResults.map((result) => result.status === 'rejected' ? result.reason : undefined)).toEqual([
      childFailure,
      childFailure,
    ]);
    expect(child.attempts).toBe(2);
    expect(rootDisposable.onDestroy).toHaveBeenCalledOnce();
  });

  it('detaches a retained child after a later direct retry fails', async () => {
    // Given
    const childToken = Symbol('parent-then-direct-child');
    const rootToken = Symbol('parent-then-direct-root');
    const parentFailure = new Error('parent-origin child failed');
    const directFailure = new Error('direct retry child failed');
    const child = createDisposalProbe([parentFailure, directFailure, undefined]);
    const rootDisposable = { onDestroy: vi.fn() };
    const root = new Container().register(
      { provide: childToken, scope: 'request', useFactory: () => child },
      { provide: rootToken, useValue: rootDisposable },
    );
    const childScope = root.createRequestScope();
    await childScope.resolve(childToken);
    await root.resolve(rootToken);

    // When
    await expect(root.dispose()).rejects.toBe(parentFailure);
    await expect(childScope.dispose()).rejects.toBe(directFailure);
    await root.dispose();

    // Then
    expect(child.attempts).toBe(2);
    expect(rootDisposable.onDestroy).toHaveBeenCalledOnce();
  });

  it('releases root stale observers when a direct child retry fails after detachment', async () => {
    // Given
    const configToken = Symbol('stale-observer-config');
    const childToken = Symbol('stale-observer-child');
    const childFailure = new Error('stale child cleanup failed');
    const directRetryFailure = new Error('direct stale child retry failed');
    const child = createDisposalProbe([childFailure, directRetryFailure, undefined]);
    const root = new Container().register(
      { provide: configToken, useValue: 'before-override' },
      { provide: childToken, scope: 'request', useFactory: () => child, inject: [configToken] },
    );
    const childScope = root.createRequestScope();
    await childScope.resolve(childToken);

    // When
    root.override({ provide: configToken, useValue: 'after-override' });
    await expect(root.resolve(configToken)).rejects.toBe(childFailure);
    await root.resolve(configToken);
    await expect(childScope.dispose()).rejects.toBe(directRetryFailure);

    // Then
    expect((root as unknown as { staleDisposalTasks: ReadonlySet<unknown> }).staleDisposalTasks.size).toBe(0);
    expect((childScope as unknown as { staleDisposalTasks: ReadonlySet<unknown> }).staleDisposalTasks.size).toBe(1);

    // When
    await childScope.dispose();

    // Then
    expect(child.attempts).toBe(3);
  });
});
