import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AfterCommitCallback,
  AfterCommitCapabilityError,
  AfterCommitError,
  DrizzleDatabase,
  type DrizzleDatabaseFacade,
  type DrizzleHandleProvider,
  Transaction,
  type TransactionBoundaryOptions,
} from './index.js';

function deferred() {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  if (!resolvePromise) {
    throw new Error('Deferred resolver was not initialized.');
  }
  return { promise, resolve: resolvePromise };
}

function nativeFixture(beforeCommit?: () => Promise<void>) {
  const events: string[] = [];
  let sequence = 0;
  const database = {
    id: 0,
    async transaction<T>(callback: (value: { readonly id: number }) => Promise<T>): Promise<T> {
      const id = ++sequence;
      events.push(`begin:${id}`);
      try {
        const result = await callback({ id });
        await beforeCommit?.();
        events.push(`commit:${id}`);
        return result;
      } catch (error) {
        events.push(`rollback:${id}`);
        throw error;
      }
    },
  };
  const drizzle = DrizzleDatabase.createFacade<typeof database, { readonly id: number }>(
    database,
    () => {
      events.push('dispose');
    },
  );
  return { database, drizzle, events };
}

describe('Drizzle afterCommit', { timeout: 2_000 }, () => {
  it('runs registered work only after the native commit resolves', async () => {
    // Given: a native transaction that records its commit separately from the callback.
    const events: string[] = [];
    const transactionDatabase = { id: 'transaction' };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('begin');
        const result = await callback(transactionDatabase);
        events.push('commit');
        return result;
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database);

    // When: the callback registers a synchronous side effect.
    const result = await drizzle.transaction(async () => {
      expect(drizzle.afterCommit(() => {
        expect(drizzle.current()).toBe(database);
        events.push('hook');
      })).toBeUndefined();
      events.push('callback');
      return 42;
    });

    // Then: the public boundary preserves its result and waits for the committed hook.
    expect(result).toBe(42);
    expect(events).toEqual(['begin', 'callback', 'commit', 'hook']);
  });

  it('waits for native commit and drains asynchronous hooks sequentially in FIFO order', async () => {
    // Given: independent native-commit and hook-completion barriers.
    const commitEntered = deferred();
    const commitRelease = deferred();
    const firstEntered = deferred();
    const firstRelease = deferred();
    const { drizzle, events } = nativeFixture(async () => {
      commitEntered.resolve();
      await commitRelease.promise;
    });
    let settled = false;
    const run = drizzle.transaction(async () => {
      drizzle.afterCommit(async () => {
        events.push('first:start');
        firstEntered.resolve();
        await firstRelease.promise;
        events.push('first:end');
      });
      drizzle.afterCommit(async () => {
        events.push('second');
      });
      return 'result';
    });
    const observed = run.finally(() => { settled = true; });

    try {
      // When: native commit remains pending, and then the first hook remains pending.
      await commitEntered.promise;
      expect(events).toEqual(['begin:1']);
      expect(settled).toBe(false);
      commitRelease.resolve();
      await firstEntered.promise;

      // Then: later hooks and boundary settlement cannot overtake the first hook.
      expect(events).toEqual(['begin:1', 'commit:1', 'first:start']);
      expect(settled).toBe(false);
      firstRelease.resolve();
      await expect(observed).resolves.toBe('result');
      expect(events).toEqual(['begin:1', 'commit:1', 'first:start', 'first:end', 'second']);
    } finally {
      commitRelease.resolve();
      firstRelease.resolve();
      await Promise.allSettled([observed]);
    }
  });

  it.each(['transaction', 'requestTransaction'] as const)(
    'shares nested request and service hooks with the %s owner despite a caught nested throw',
    async (entry) => {
      // Given: a decorated service and a request share a native owner without savepoints.
      const { drizzle, events } = nativeFixture();
      const failure = new Error('nested work failed');
      class Service {
        readonly db = drizzle;

        @Transaction(undefined, undefined, { requireAfterCommit: true })
        async run() {
          expect(this.db.current().id).toBe(1);
          this.db.afterCommit(() => { events.push('service'); });
          throw failure;
        }
      }

      // When: the outer callback catches a nested failure and chooses to commit.
      const result = await drizzle[entry](async () => {
        drizzle.afterCommit(() => { events.push('outer'); });
        await expect(new Service().run()).rejects.toBe(failure);
        await drizzle.requestTransaction(async () => {
          expect(drizzle.current().id).toBe(1);
          drizzle.afterCommit(() => { events.push('request'); });
        }, undefined, undefined, { requireAfterCommit: true });
        expect(events).toEqual(['begin:1']);
        return 'committed';
      });

      // Then: all registrations follow the final outer outcome, once and in order.
      expect(result).toBe('committed');
      expect(events).toEqual(['begin:1', 'commit:1', 'outer', 'service', 'request']);
    },
  );

  it.each(['transaction', 'requestTransaction'] as const)(
    'discards hooks on %s callback failure without leaking into a later owner',
    async (entry) => {
      // Given: both outer and nested callbacks register work before failure.
      const { drizzle, events } = nativeFixture();
      const failure = new Error('callback failed');

      // When: the failure escapes the owning callback.
      await expect(drizzle[entry](async () => {
        drizzle.afterCommit(() => { events.push('outer:discarded'); });
        await drizzle.transaction(async () => {
          drizzle.afterCommit(() => { events.push('nested:discarded'); });
          throw failure;
        });
      })).rejects.toBe(failure);
      await drizzle[entry](async () => {
        drizzle.afterCommit(() => { events.push('fresh'); });
      });

      // Then: rollback suppresses every failed-owner hook, and the fresh owner remains usable.
      expect(events).toEqual(['begin:1', 'rollback:1', 'begin:2', 'commit:2', 'fresh']);
    },
  );

  it.each(['transaction', 'requestTransaction'] as const)(
    'discards hooks when %s native commit fails after the callback succeeds',
    async (entry) => {
      // Given: the native promise rejects after user work has returned.
      const failure = new Error('commit failed');
      const { drizzle, events } = nativeFixture(async () => { throw failure; });

      // When: native commit fails.
      await expect(drizzle[entry](async () => {
        drizzle.afterCommit(() => { events.push('unreachable'); });
      })).rejects.toBe(failure);

      // Then: no after-commit work is attempted.
      expect(events).toEqual(['begin:1', 'rollback:1']);
    },
  );

  it('isolates queues when concurrent owners commit in reverse order', async () => {
    // Given: two independent boundaries have separate release barriers.
    const firstEntered = deferred();
    const secondEntered = deferred();
    const firstRelease = deferred();
    const secondRelease = deferred();
    const { drizzle, events } = nativeFixture();
    const first = drizzle.transaction(async () => {
      drizzle.afterCommit(() => { events.push('first'); });
      firstEntered.resolve();
      await firstRelease.promise;
      expect(drizzle.current().id).toBe(1);
    });
    const second = drizzle.requestTransaction(async () => {
      drizzle.afterCommit(() => { events.push('second'); });
      secondEntered.resolve();
      await secondRelease.promise;
      expect(drizzle.current().id).toBe(2);
    });
    try {
      // When: the second owner commits before the first.
      await Promise.all([firstEntered.promise, secondEntered.promise]);
      secondRelease.resolve();
      await second;
      expect(events).toEqual(['begin:1', 'begin:2', 'commit:2', 'second']);
      firstRelease.resolve();
      await first;

      // Then: each boundary drains only its own registrations.
      expect(events).toEqual(['begin:1', 'begin:2', 'commit:2', 'second', 'commit:1', 'first']);
    } finally {
      firstRelease.resolve();
      secondRelease.resolve();
      await Promise.allSettled([first, second]);
    }
  });

  it.each(['abort', 'shutdown'] as const)(
    'suppresses hooks when %s interrupts pending request work',
    async (interruption) => {
      // Given: a request is still inside its callback when cancellation arrives.
      const controller = new AbortController();
      const entered = deferred();
      const release = deferred();
      const callbackDone = deferred();
      const { drizzle, events } = nativeFixture();
      const run = drizzle.requestTransaction(async () => {
        drizzle.afterCommit(() => { events.push('unreachable'); });
        entered.resolve();
        await release.promise;
        callbackDone.resolve();
      }, controller.signal);
      const observed = Promise.allSettled([run]);
      let shutdown: Promise<void> | undefined;
      try {
        await entered.promise;
        // When: cancellation happens before the native transaction can commit.
        if (interruption === 'abort') {
          controller.abort();
        } else {
          shutdown = drizzle.onApplicationShutdown();
        }
        const [result] = await observed;
        expect(result).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
        release.resolve();
        await callbackDone.promise;
        await shutdown;

        // Then: the native callback rolls back, and queued hooks are never run.
        expect(events).toEqual(interruption === 'abort'
          ? ['begin:1', 'rollback:1']
          : ['begin:1', 'rollback:1', 'dispose']);
      } finally {
        release.resolve();
        await Promise.allSettled([run, callbackDone.promise, shutdown ?? Promise.resolve()]);
      }
    },
  );

  it.each(['transaction', 'requestTransaction'] as const)(
    'drains all %s hook outcomes and reports failures without entering native rollback',
    async (entry) => {
      // Given: successful, synchronously throwing, and asynchronously rejecting hooks.
      const { drizzle, events } = nativeFixture();
      const firstFailure = new Error('first failure');
      const secondFailure = new Error('second failure');
      const run = drizzle[entry](async () => {
        drizzle.afterCommit(() => { events.push('success'); });
        drizzle.afterCommit(() => { events.push('sync'); throw firstFailure; });
        drizzle.afterCommit(async () => { events.push('async'); throw secondFailure; });
        drizzle.afterCommit(() => { events.push('last'); });
      });

      // When: the committed hooks fail.
      const [outcome] = await Promise.allSettled([run]);
      if (outcome?.status !== 'rejected' || !(outcome.reason instanceof AfterCommitError)) {
        throw new Error('Expected an AfterCommitError.');
      }

      // Then: all outcomes and only rejected reasons are exposed in FIFO order.
      expect(outcome.reason).toBeInstanceOf(AggregateError);
      expect(outcome.reason.committed).toBe(true);
      expect(outcome.reason.errors).toEqual([firstFailure, secondFailure]);
      expect(outcome.reason.results).toEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: firstFailure },
        { status: 'rejected', reason: secondFailure },
        { status: 'fulfilled', value: undefined },
      ]);
      expect(events).toEqual(['begin:1', 'commit:1', 'success', 'sync', 'async', 'last']);
    },
  );

  it.each(['transaction', 'requestTransaction'] as const)(
    'keeps shutdown behind %s hooks and never reclassifies their confirmed commit',
    async (entry) => {
      // Given: the native commit is done but the first hook is suspended.
      const entered = deferred();
      const release = deferred();
      const { drizzle, events } = nativeFixture();
      const failure = new Error('hook failed during shutdown');
      const run = drizzle[entry](async () => {
        drizzle.afterCommit(async () => {
          events.push('hook:start');
          entered.resolve();
          await release.promise;
          events.push('hook:end');
          throw failure;
        });
        drizzle.afterCommit(() => { events.push('last'); });
      });
      const observed = Promise.allSettled([run]);
      let shutdown: Promise<void> | undefined;
      try {
        await entered.promise;
        // When: shutdown begins during committed hook work.
        shutdown = drizzle.onApplicationShutdown();
        expect(events).toEqual(['begin:1', 'commit:1', 'hook:start']);
        release.resolve();
        const [result] = await observed;
        await shutdown;

        // Then: hooks drain before disposal; their error still denotes a confirmed commit.
        expect(result).toMatchObject({
          status: 'rejected',
          reason: { name: 'AfterCommitError', committed: true, errors: [failure] },
        });
        expect(events).toEqual(['begin:1', 'commit:1', 'hook:start', 'hook:end', 'last', 'dispose']);
      } finally {
        release.resolve();
        await Promise.allSettled([run, shutdown ?? Promise.resolve()]);
      }
    },
  );

  it('runs hooks outside ended request ALS so they can open fresh transactions after request abort', async () => {
    // Given: a committed request hook aborts the original signal before opening another request.
    const controller = new AbortController();
    const { database, drizzle, events } = nativeFixture();

    // When: the hook creates a fresh native owner.
    await drizzle.requestTransaction(async () => {
      drizzle.afterCommit(async () => {
        controller.abort();
        expect(drizzle.current()).toBe(database);
        expect(drizzle.id).toBe(0);
        expect(() => drizzle.afterCommit(() => {})).toThrow(AfterCommitCapabilityError);
        await drizzle.requestTransaction(async () => {
          expect(drizzle.current().id).toBe(2);
          drizzle.afterCommit(() => { events.push('fresh'); });
        }, undefined, undefined, { requireAfterCommit: true });
        expect(drizzle.current()).toBe(database);
      });
    }, controller.signal);

    // Then: no ended session or inherited abort signal contaminates the fresh owner.
    expect(events).toEqual(['begin:1', 'commit:1', 'begin:2', 'commit:2', 'fresh']);
  });

  it('rejects inherited late registration once the callback closes, before native commit settles', async () => {
    // Given: an inherited continuation outlives the owner callback, while commit is held.
    const callbackClosed = deferred();
    const commitRelease = deferred();
    const lateRelease = deferred();
    const { drizzle, events } = nativeFixture(async () => {
      callbackClosed.resolve();
      await commitRelease.promise;
    });
    let late: Promise<void> | undefined;
    const run = drizzle.transaction(async () => {
      drizzle.afterCommit(() => { events.push('registered'); });
      late = lateRelease.promise.then(() => {
        drizzle.afterCommit(() => { events.push('late'); });
      });
    });
    try {
      await callbackClosed.promise;
      if (!late) {
        throw new Error('Late continuation was not registered.');
      }
      // When: inherited work attempts registration after the owning callback has closed.
      const observed = expect(late).rejects.toBeInstanceOf(AfterCommitCapabilityError);
      lateRelease.resolve();
      await observed;
      commitRelease.resolve();
      await run;

      // Then: only the original registration drains.
      expect(events).toEqual(['begin:1', 'commit:1', 'registered']);
      expect(() => drizzle.afterCommit(() => {})).toThrow(AfterCommitCapabilityError);
    } finally {
      lateRelease.resolve();
      commitRelease.resolve();
      await Promise.allSettled([run, late ?? Promise.resolve()]);
    }
  });

  it.each(['transaction', 'requestTransaction'] as const)(
    'rejects registration in %s fail-open fallback while preserving direct execution',
    async (entry) => {
      // Given: the default non-atomic fallback has no native commit capability.
      const drizzle = new DrizzleDatabase({});
      let called = false;

      // When: user work explicitly tries to register a hook.
      const result = await drizzle[entry](async () => {
        called = true;
        expect(() => drizzle.afterCommit(() => {})).toThrow(AfterCommitCapabilityError);
        return 42;
      });

      // Then: default fallback still executes, but cannot claim after-commit guarantees.
      expect(called).toBe(true);
      expect(result).toBe(42);
    },
  );

  it('preflights manual, request, and decorator boundaries before fallback user work', async () => {
    // Given: no native driver exists and the new capability requirement is enabled.
    const drizzle = new DrizzleDatabase({});
    const boundary: TransactionBoundaryOptions = { requireAfterCommit: true };
    let calls = 0;
    const callback = async () => { calls += 1; };
    class Service {
      readonly db = drizzle;
      @Transaction(undefined, undefined, boundary)
      async run() { calls += 1; }
    }

    // When: each public entry point requires native after-commit support.
    await expect(drizzle.transaction(callback, undefined, boundary)).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    await expect(drizzle.requestTransaction(callback, undefined, undefined, boundary)).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    await expect(new Service().run()).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    await drizzle.transaction(async () => {
      await expect(drizzle.transaction(callback, undefined, boundary)).rejects.toBeInstanceOf(AfterCommitCapabilityError);
      await expect(drizzle.requestTransaction(callback, undefined, undefined, boundary)).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    });

    // Then: no required callback has run.
    expect(calls).toBe(0);
  });

  it.each(['implicit', 'explicit'] as const)('rejects required decorators targeting an %s transaction-only handle before user work', async (target) => {
    // Given: the supported structural target heuristic finds a raw transaction-only handle.
    let calls = 0;
    let transactionCalls = 0;
    class Service {
      readonly db = {
        async transaction<T>(callback: () => Promise<T>): Promise<T> {
          transactionCalls += 1;
          return callback();
        },
      };
      @Transaction(undefined, undefined, { requireAfterCommit: true })
      async implicit() { calls += 1; }
      @Transaction((self: Service) => self.db, undefined, { requireAfterCommit: true })
      async explicit() { calls += 1; }
    }

    // When: a method requires after-commit support not provided by that target.
    await expect(new Service()[target]()).rejects.toBeInstanceOf(AfterCommitCapabilityError);

    // Then: capability failure occurs before any decorated user work.
    expect(calls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it('keeps native options positions and exposes the new package-owned API types', async () => {
    // Given: a typed driver records only its native options argument.
    type Options = { readonly isolationLevel: 'serializable' };
    const options: Options = { isolationLevel: 'serializable' };
    const boundary: TransactionBoundaryOptions = { requireAfterCommit: true };
    const recorded: (Options | undefined)[] = [];
    const database = {
      async transaction<T>(callback: (value: object) => Promise<T>, value?: Options): Promise<T> {
        recorded.push(value);
        return callback({});
      },
    };
    const drizzle = DrizzleDatabase.createFacade<typeof database, object, Options>(database);
    const provider: DrizzleHandleProvider<typeof database, object, Options> = drizzle;
    const callback: AfterCommitCallback = async () => {};
    const results: readonly PromiseSettledResult<void>[] = [{ status: 'fulfilled', value: undefined }];
    expectTypeOf(provider.afterCommit).toEqualTypeOf<(callback: AfterCommitCallback) => void>();
    expectTypeOf<AfterCommitCallback>().toEqualTypeOf<() => void | Promise<void>>();
    expectTypeOf<TransactionBoundaryOptions>().toEqualTypeOf<{ readonly requireAfterCommit?: boolean }>();
    expectTypeOf(AfterCommitError).constructorParameters.toEqualTypeOf<[results: readonly PromiseSettledResult<void>[]]>();
    expectTypeOf(new AfterCommitError(results).results).toEqualTypeOf<readonly PromiseSettledResult<void>[]>();
    expectTypeOf(new AfterCommitError(results).committed).toEqualTypeOf<true>();
    expectTypeOf(drizzle).toEqualTypeOf<DrizzleDatabaseFacade<typeof database, object, Options>>();
    class Service {
      readonly db = drizzle;
      @Transaction((self: Service) => self.db, options, boundary)
      async run() { this.db.afterCommit(callback); return 'decorator'; }
    }

    // When: boundary requirements follow every pre-existing parameter.
    await expect(provider.transaction(async () => { provider.afterCommit(callback); return 1; }, options, boundary)).resolves.toBe(1);
    await expect(provider.requestTransaction(async () => { provider.afterCommit(callback); return 2; }, undefined, options, boundary)).resolves.toBe(2);
    await expect(new Service().run()).resolves.toBe('decorator');

    // Then: native options are unchanged and never receive the Fluo boundary object.
    expect(recorded).toEqual([options, options, options]);
    expect(recorded.every((value) => value === options)).toBe(true);
  });

  it.each(['hook', 'required', 'nested-required', 'legacy'] as const)(
    'handles abort during native commit for a %s boundary',
    async (mode) => {
      // Given: user work has finished, but the native commit promise is still pending.
      const commitEntered = deferred();
      const commitRelease = deferred();
      const controller = new AbortController();
      const { drizzle, events } = nativeFixture(async () => {
        commitEntered.resolve();
        await commitRelease.promise;
      });
      const run = drizzle.requestTransaction(async () => {
        if (mode === 'hook') {
          drizzle.afterCommit(() => { events.push('hook'); });
        } else if (mode === 'nested-required') {
          await drizzle.transaction(async () => {}, undefined, { requireAfterCommit: true });
        }
        return 'committed';
      }, controller.signal, undefined, mode === 'required' ? { requireAfterCommit: true } : undefined);
      const observed = Promise.allSettled([run]);
      try {
        await commitEntered.promise;

        // When: cancellation arrives while the native driver is committing successfully.
        controller.abort(new Error('aborted during native commit'));
        commitRelease.resolve();
        const [outcome] = await observed;

        // Then: opt-in boundaries honor confirmed commit; no-hook legacy behavior is unchanged.
        if (mode === 'legacy') {
          expect(outcome).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
        } else {
          expect(outcome).toEqual({ status: 'fulfilled', value: 'committed' });
        }
        expect(events).toEqual(mode === 'hook'
          ? ['begin:1', 'commit:1', 'hook']
          : ['begin:1', 'commit:1']);
      } finally {
        commitRelease.resolve();
        await observed;
      }
    },
  );

  it.each([
    ['transaction', 'transaction'],
    ['transaction', 'requestTransaction'],
    ['requestTransaction', 'transaction'],
    ['requestTransaction', 'requestTransaction'],
  ] as const)(
    'allows a started %s child to register during %s owner drain without accepting closed continuations',
    async (childEntry, ownerEntry) => {
      // Given: the owner drains started callbacks after its own user callback returns.
      const drainEntered = deferred();
      const childRelease = deferred();
      const siblingRelease = deferred();
      const parentLateRelease = deferred();
      const childLateRelease = deferred();
      const { database, events } = nativeFixture();
      const drizzle = new DrizzleDatabase<typeof database, { readonly id: number }>(database);
      const closeOwnerMethod = 'closeTransactionBoundaryOwner';
      const closeOwner = drizzle[closeOwnerMethod].bind(drizzle);
      drizzle[closeOwnerMethod] = (owner) => {
        // Observe entry without replacing the real callback drain or its settlement semantics.
        const closing = closeOwner(owner);
        drainEntered.resolve();
        return closing;
      };
      let child: Promise<void> | undefined;
      let sibling: Promise<void> | undefined;
      let parentLate: Promise<void> | undefined;
      let childLate: Promise<void> | undefined;
      const run = drizzle[ownerEntry](async () => {
        drizzle.afterCommit(() => { events.push('parent'); });
        parentLate = parentLateRelease.promise.then(() => {
          drizzle.afterCommit(() => { events.push('parent:late'); });
        });
        child = drizzle[childEntry](async () => {
          childLate = childLateRelease.promise.then(() => {
            drizzle.afterCommit(() => { events.push('child:late'); });
          });
          await childRelease.promise;
          drizzle.afterCommit(() => { events.push('child'); });
          await drizzle.transaction(async () => {
            drizzle.afterCommit(() => { events.push('grandchild'); });
          }, undefined, { requireAfterCommit: true });
        });
        sibling = drizzle.transaction(async () => { await siblingRelease.promise; });
      });
      try {
        await drainEntered.promise;
        if (!child || !sibling || !parentLate) {
          throw new Error('Owner callbacks did not start.');
        }

        // When: a closed parent continuation and a still-running child attempt registration.
        const parentRejected = expect(parentLate).rejects.toBeInstanceOf(AfterCommitCapabilityError);
        parentLateRelease.resolve();
        await parentRejected;
        const childResult = expect(child).resolves.toBeUndefined();
        childRelease.resolve();
        await childResult;
        if (!childLate) {
          throw new Error('Child continuation did not start.');
        }

        // Then: the child remains eligible only until its own callback finishes.
        const childRejected = expect(childLate).rejects.toBeInstanceOf(AfterCommitCapabilityError);
        childLateRelease.resolve();
        await childRejected;
        expect(events).toEqual(['begin:1']);
        siblingRelease.resolve();
        await Promise.all([run, sibling]);
        expect(events).toEqual(['begin:1', 'commit:1', 'parent', 'child', 'grandchild']);
      } finally {
        parentLateRelease.resolve();
        childRelease.resolve();
        childLateRelease.resolve();
        siblingRelease.resolve();
        await Promise.allSettled([run, child, sibling, parentLate, childLate]);
      }
    },
  );
});
