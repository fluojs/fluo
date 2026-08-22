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

// allow: SIZE_OK — Disposal retry ownership is one concurrency state matrix at the public Container.dispose() seam.
describe('Container disposal retry', () => {
  it('retries only failed hooks in reverse creation order', async () => {
    // Given
    const events: string[] = [];
    const firstFailure = new Error('first failed');
    const lastFailure = new Error('last failed');
    let firstAttempts = 0;
    let lastAttempts = 0;

    class FirstFailingService {
      onDestroy(): void {
        firstAttempts += 1;
        events.push(`first:${firstAttempts}`);

        if (firstAttempts === 1) {
          throw firstFailure;
        }
      }
    }

    class SuccessfulService {
      readonly onDestroy = vi.fn(() => {
        events.push('successful');
      });
    }

    class LastFailingService {
      onDestroy(): void {
        lastAttempts += 1;
        events.push(`last:${lastAttempts}`);

        if (lastAttempts === 1) {
          throw lastFailure;
        }
      }
    }

    const container = new Container().register(
      FirstFailingService,
      SuccessfulService,
      LastFailingService,
    );
    await container.resolve(FirstFailingService);
    const successfulService = await container.resolve<SuccessfulService>(SuccessfulService);
    await container.resolve(LastFailingService);

    // When
    const firstError = await container.dispose().catch((error: unknown) => error);

    // Then
    if (!(firstError instanceof AggregateError)) {
      expect.unreachable('expected the first disposal to aggregate both failed hooks');
    }

    expect(firstError.errors).toEqual([lastFailure, firstFailure]);
    expect(events).toEqual(['last:1', 'successful', 'first:1']);

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['last:1', 'successful', 'first:1', 'last:2', 'first:2']);
    expect(successfulService.onDestroy).toHaveBeenCalledOnce();

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['last:1', 'successful', 'first:1', 'last:2', 'first:2']);
  });

  it('retries nested request scopes before their parent and root', async () => {
    // Given
    const events: string[] = [];
    let childAttempts = 0;
    let parentAttempts = 0;
    let rootAttempts = 0;

    class RootService {
      onDestroy(): void {
        rootAttempts += 1;
        events.push(`root:${rootAttempts}`);

        if (rootAttempts === 1) {
          throw new Error('root failed');
        }
      }
    }

    class ParentRequestService {
      onDestroy(): void {
        parentAttempts += 1;
        events.push(`parent:${parentAttempts}`);

        if (parentAttempts === 1) {
          throw new Error('parent failed');
        }
      }
    }

    class ChildRequestService {
      onDestroy(): void {
        childAttempts += 1;
        events.push(`child:${childAttempts}`);

        if (childAttempts === 1) {
          throw new Error('child failed');
        }
      }
    }

    const root = new Container().register(
      RootService,
      { provide: ParentRequestService, scope: 'request', useClass: ParentRequestService },
      { provide: ChildRequestService, scope: 'request', useClass: ChildRequestService },
    );
    const parentScope = root.createRequestScope();
    const childScope = parentScope.createRequestScope();
    await root.resolve(RootService);
    await parentScope.resolve(ParentRequestService);
    await childScope.resolve(ChildRequestService);

    // When
    const firstError = await root.dispose().catch((error: unknown) => error);

    // Then
    if (!(firstError instanceof AggregateError)) {
      expect.unreachable('expected child, parent, and root disposal failures to be aggregated');
    }

    expect(firstError.errors.map((error) => error instanceof Error ? error.message : error)).toEqual([
      'child failed',
      'parent failed',
      'root failed',
    ]);
    expect(events).toEqual(['child:1', 'parent:1', 'root:1']);

    // When
    await root.dispose();

    // Then
    expect(events).toEqual(['child:1', 'parent:1', 'root:1', 'child:2', 'parent:2', 'root:2']);
  });

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

  it('shares the active disposal while retaining failed cleanup for a later retry', async () => {
    // Given
    const failure = new Error('shared disposal failed');
    let attempts = 0;
    let releaseFirstAttempt = (): void => {};
    let reportAttemptStarted = (): void => {};
    const firstAttemptCanFinish = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    const attemptStarted = new Promise<void>((resolve) => {
      reportAttemptStarted = resolve;
    });

    class SharedDisposalService {
      async onDestroy(): Promise<void> {
        attempts += 1;
        reportAttemptStarted();
        await firstAttemptCanFinish;

        if (attempts === 1) {
          throw failure;
        }
      }
    }

    const container = new Container().register(SharedDisposalService);
    await container.resolve(SharedDisposalService);

    // When
    const firstDispose = container.dispose();
    const concurrentDispose = container.dispose();
    await attemptStarted;

    // Then
    expect(attempts).toBe(1);

    // When
    releaseFirstAttempt();
    const concurrentResults = await Promise.allSettled([firstDispose, concurrentDispose]);

    // Then
    expect(concurrentResults.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(concurrentResults.map((result) => result.status === 'rejected' ? result.reason : undefined)).toEqual([
      failure,
      failure,
    ]);

    // When
    await container.dispose();

    // Then
    expect(attempts).toBe(2);
  });

  it('keeps every operation terminal after failed disposal starts', async () => {
    // Given
    let attempts = 0;

    class RetryingService {
      onDestroy(): void {
        attempts += 1;

        if (attempts === 1) {
          throw new Error('retrying service failed');
        }
      }
    }

    class LaterService {}

    const container = new Container().register(RetryingService);
    await container.resolve(RetryingService);

    // When
    await expect(container.dispose()).rejects.toThrow('retrying service failed');

    // Then
    await expect(container.resolve(RetryingService)).rejects.toThrow('Container has been disposed');
    expect(() => container.register(LaterService)).toThrow('Container has been disposed');
    expect(() => container.override(RetryingService)).toThrow('Container has been disposed');
    expect(() => container.createRequestScope()).toThrow('Container has been disposed');

    // When
    await container.dispose();

    // Then
    expect(attempts).toBe(2);
  });
});
