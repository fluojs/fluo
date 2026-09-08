import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AfterCommitError,
  DrizzleDatabase,
  type DrizzleHandleProvider,
  Transaction,
  type TransactionBoundaryOptions,
  TransactionRollbackCapabilityError,
  TransactionRollbackOnlyError,
} from './index.js';

// Protocol double for these deterministic native-runner fixtures. Real driver
// confirmation is exercised by rollback-observer tests and the PostgreSQL/Mongo fixture.
const observerDouble = {
  run: <T>(callback: () => Promise<T>): Promise<T> => callback(),
  beginAttempt: () => ({ confirmRollback: () => true as const }),
};

function deferred() {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  if (!release) {
    throw new Error('Deferred resolver was not initialized.');
  }
  return { promise, resolve: release };
}

function nativeFixture(beforeRollback?: () => Promise<void>) {
  const events: string[] = [];
  let sequence = 0;
  const database = {
    id: 0,
    async transaction<T>(callback: (handle: { readonly id: number }) => Promise<T>): Promise<T> {
      const id = ++sequence;
      events.push(`begin:${id}`);
      try {
        const result = await callback({ id });
        events.push(`commit:${id}`);
        return result;
      } catch (error) {
        await beforeRollback?.();
        events.push(`rollback:${id}`);
        throw error;
      }
    },
  };
  const drizzle = DrizzleDatabase.createFacade<typeof database, { readonly id: number }>(database, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
  return { database, drizzle, events };
}

describe('Drizzle opt-in Result rollback', { timeout: 2_000 }, () => {
  it.each(['transaction', 'requestTransaction'] as const)(
    'returns the same root failure only after native rollback settles through %s',
    async (entry) => {
      // Given: rollback has an explicit completion barrier, and the callback registered a hook.
      const rollbackEntered = deferred();
      const rollbackRelease = deferred();
      const { database, drizzle, events } = nativeFixture(async () => {
        rollbackEntered.resolve();
        await rollbackRelease.promise;
      });
      const failure = { rejected: true };
      const boundary: TransactionBoundaryOptions<typeof failure> = { shouldRollback: (value) => value.rejected };
      const callback = async () => {
        drizzle.afterCommit(() => { events.push('hook'); });
        return failure;
      };
      let settled = false;

      // When: the application opts in to treating that exact value as a rollback outcome.
      const run = entry === 'transaction'
        ? drizzle.transaction(callback, undefined, boundary)
        : drizzle.requestTransaction(callback, undefined, undefined, boundary);
      const observed = run.finally(() => { settled = true; });
      try {
        await rollbackEntered.promise;
        expect(settled).toBe(false);
        expect(events).toEqual(['begin:1']);
        rollbackRelease.resolve();

        // Then: native rollback precedes the unchanged result, with no hook drain.
        await expect(observed).resolves.toBe(failure);
        expect(events).toEqual(['begin:1', 'rollback:1']);
        expect(drizzle.current()).toBe(database);
        expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(0);
      } finally {
        rollbackRelease.resolve();
        await Promise.allSettled([observed]);
      }
    },
  );

  it.each([undefined, null, false, 0, Symbol('failure'), { ok: false }])(
    'does not infer a Result shape from %s without an application policy',
    async (value) => {
      // Given: an arbitrary callback value with no rollback policy.
      const { drizzle, events } = nativeFixture();

      // When: the value crosses the ordinary boundary.
      const result = await drizzle.transaction(async () => {
        drizzle.afterCommit(() => { events.push('hook'); });
        return value;
      });

      // Then: ordinary return values retain commit and hook behavior.
      expect(result).toBe(value);
      expect(events).toEqual(['begin:1', 'commit:1', 'hook']);
    },
  );

  it.each([
    ['transaction', 'transaction'],
    ['transaction', 'requestTransaction'],
    ['requestTransaction', 'transaction'],
    ['requestTransaction', 'requestTransaction'],
  ] as const)(
    'waits for unsettled %s children before asserting the %s owner rollback-only state',
    async (childEntry, ownerEntry) => {
      // Given: the root returns before its opted child and an unrelated sibling have settled.
      const closingEntered = deferred();
      const childRelease = deferred();
      const siblingRelease = deferred();
      const { drizzle, events } = nativeFixture();
      const failure = { rejected: true };
      const boundary: TransactionBoundaryOptions<typeof failure> = { shouldRollback: (value) => value.rejected };
      const closeOwnerMethod = 'closeTransactionBoundaryOwner';
      const closeOwner = drizzle[closeOwnerMethod].bind(drizzle);
      drizzle[closeOwnerMethod] = (owner) => {
        const closing = closeOwner(owner);
        closingEntered.resolve();
        return closing;
      };
      let child: Promise<typeof failure> | undefined;
      let sibling: Promise<void> | undefined;
      const run = drizzle[ownerEntry](async () => {
        drizzle.afterCommit(() => { events.push('root:hook'); });
        const callback = async () => {
          await childRelease.promise;
          drizzle.afterCommit(() => { events.push('child:hook'); });
          return failure;
        };
        child = childEntry === 'transaction'
          ? drizzle.transaction(callback, undefined, boundary)
          : drizzle.requestTransaction(callback, undefined, undefined, boundary);
        sibling = drizzle.transaction(async () => { await siblingRelease.promise; });
        return 'accepted root';
      });
      const observed = Promise.allSettled([run]);
      try {
        await closingEntered.promise;
        if (!child || !sibling) {
          throw new Error('Nested callbacks were not started.');
        }

        // When: only the opted child settles, the remaining sibling still owns live work.
        childRelease.resolve();
        await expect(child).resolves.toBe(failure);
        expect(events).toEqual(['begin:1']);
        siblingRelease.resolve();
        const [outcome] = await observed;
        await sibling;

        // Then: sticky rollback is asserted after all callbacks, not before or between them.
        expect(outcome?.status).toBe('rejected');
        if (outcome?.status !== 'rejected') {
          throw new Error('The root unexpectedly committed.');
        }
        expect(outcome.reason).toBeInstanceOf(TransactionRollbackOnlyError);
        expect(outcome.reason.result).toBe(failure);
        expect(events).toEqual(['begin:1', 'rollback:1']);
      } finally {
        childRelease.resolve();
        siblingRelease.resolve();
        await Promise.allSettled([observed, child, sibling]);
      }
    },
  );

  it('retains the first nested failure even when later values and predicates accept commit', async () => {
    // Given: multiple nested results share one native transaction.
    const { drizzle, events } = nativeFixture();
    const first = { rejected: true, name: 'first' };
    const second = { rejected: true, name: 'second' };
    const boundary: TransactionBoundaryOptions<typeof first> = { shouldRollback: (value) => value.rejected };

    // When: two children reject their values, but a later child and the root accept theirs.
    const run = drizzle.transaction(async () => {
      expect(await drizzle.transaction(async () => first, undefined, boundary)).toBe(first);
      expect(await drizzle.requestTransaction(async () => second, undefined, undefined, boundary)).toBe(second);
      await drizzle.transaction(async () => 'accepted', undefined, { shouldRollback: () => false });
      return 'accepted root';
    }, undefined, { shouldRollback: () => false });

    // Then: no later evaluation clears or replaces the first sticky failure.
    await expect(run).rejects.toMatchObject({ result: first });
    await expect(run).rejects.toBeInstanceOf(TransactionRollbackOnlyError);
    expect(events).toEqual(['begin:1', 'rollback:1']);
  });

  it.each(['transaction', 'requestTransaction'] as const)(
    'returns its own opted root failure rather than the first nested failure through %s',
    async (entry) => {
      // Given: distinct nested and root failure identities.
      const { drizzle, events } = nativeFixture();
      const nestedFailure = { rejected: true, source: 'nested' };
      const rootFailure = { rejected: true, source: 'root' };
      const boundary: TransactionBoundaryOptions<typeof rootFailure> = { shouldRollback: (value) => value.rejected };
      const callback = async () => {
        await drizzle.transaction(async () => nestedFailure, undefined, boundary);
        return rootFailure;
      };

      // When: the root policy also explicitly rejects the returned root value.
      const result = entry === 'transaction'
        ? await drizzle.transaction(callback, undefined, boundary)
        : await drizzle.requestTransaction(callback, undefined, undefined, boundary);

      // Then: rollback recovery returns the root value, not the nested signal payload.
      expect(result).toBe(rootFailure);
      expect(events).toEqual(['begin:1', 'rollback:1']);
    },
  );

  it.each(['transaction', 'requestTransaction'] as const)(
    'preserves commit and hooks after a caught plain nested throw through %s',
    async (entry) => {
      // Given: a thrown exception, rather than an opted-in failure result.
      const { drizzle, events } = nativeFixture();
      const failure = new Error('ordinary callback failure');

      // When: the owner handles its child's exception and returns an accepted result.
      const result = await drizzle.transaction(async () => {
        await expect(drizzle[entry](async () => {
          drizzle.afterCommit(() => { events.push('nested:hook'); });
          throw failure;
        })).rejects.toBe(failure);
        return 42;
      }, undefined, { shouldRollback: (value) => value < 0 });

      // Then: a caught throw does not independently mark the shared owner rollback-only.
      expect(result).toBe(42);
      expect(events).toEqual(['begin:1', 'commit:1', 'nested:hook']);
    },
  );

  it.each(['commit', 'rollback', 'cleanup'] as const)(
    'propagates the native %s failure instead of recovering a callback value',
    async (phase) => {
      // Given: the native runner reports its own failure at a controlled settlement stage.
      const nativeFailure = new Error(`native ${phase} failed`);
      const events: string[] = [];
      const database = {
        async transaction<T>(callback: (handle: object) => Promise<T>): Promise<T> {
          try {
            const result = await callback({});
            if (phase === 'commit') {
              throw nativeFailure;
            }
            return result;
          } catch (error) {
            events.push('rollback');
            if (phase === 'rollback' || phase === 'cleanup') {
              throw nativeFailure;
            }
            throw error;
          }
        },
      };
      const drizzle = new DrizzleDatabase<typeof database, object>(database, undefined, { strictTransactions: false, rollbackObserver: observerDouble });

      // When: commit succeeds only as a policy decision, or rollback precedes native cleanup.
      const run = drizzle.requestTransaction(async () => {
        drizzle.afterCommit(() => { events.push('hook'); });
        return { rejected: phase !== 'commit' };
      }, undefined, undefined, { shouldRollback: (value) => value.rejected });

      // Then: only the exact root-owned signal is recoverable, never the native failure.
      await expect(run).rejects.toBe(nativeFailure);
      expect(events).toEqual(['rollback']);
    },
  );

  it('reports hook failures after commit without interpreting them as callback rollback', async () => {
    // Given: an accepted result and a hook that throws a rollback-only error of its own.
    const { drizzle, events } = nativeFixture();
    const hookFailure = new TransactionRollbackOnlyError('hook failure');

    // When: the native commit succeeds before the hook fails.
    const run = drizzle.transaction(async () => {
      drizzle.afterCommit(() => { throw hookFailure; });
      return 42;
    }, undefined, { shouldRollback: (value) => value < 0 });

    // Then: post-commit failures stay post-commit failures and do not become Result values.
    await expect(run).rejects.toBeInstanceOf(AfterCommitError);
    await expect(run).rejects.toMatchObject({ committed: true, errors: [hookFailure] });
    expect(events).toEqual(['begin:1', 'commit:1']);
  });

  it.each(['transaction', 'requestTransaction'] as const)(
    'isolates callback attempts and discards the failed attempt hooks through %s',
    async (entry) => {
      // Given: a native runner retries one rejected callback attempt.
      const events: string[] = [];
      const database = {
        id: 0,
        async transaction<T>(callback: (handle: { readonly id: number }) => Promise<T>): Promise<T> {
          try {
            await callback({ id: 1 });
          } catch (error) {
            if (!(error instanceof TransactionRollbackOnlyError)) {
              throw error;
            }
            events.push('rollback:1');
          }
          const result = await callback({ id: 2 });
          events.push('commit:2');
          return result;
        },
      };
      const drizzle = new DrizzleDatabase<typeof database, { readonly id: number }>(database, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
      const callback = async () => {
        const id = drizzle.current().id;
        drizzle.afterCommit(() => { events.push(`hook:${id}`); });
        if (id === 1) {
          await drizzle.transaction(async () => 'failure', undefined, { shouldRollback: () => true });
        }
        return id;
      };

      // When: the first callback attempt becomes rollback-only and the next accepts its result.
      const result = entry === 'transaction'
        ? await drizzle.transaction(callback, undefined, { shouldRollback: (value) => value < 0 })
        : await drizzle.requestTransaction(callback, undefined, undefined, { shouldRollback: (value) => value < 0 });

      // Then: the second attempt owns fresh policy, callback scope, and hook state.
      expect(result).toBe(2);
      expect(events).toEqual(['rollback:1', 'commit:2', 'hook:2']);
    },
  );

  it.each([
    ['transaction', 'transaction'],
    ['transaction', 'requestTransaction'],
    ['requestTransaction', 'transaction'],
    ['requestTransaction', 'requestTransaction'],
  ] as const)(
    'preserves an inherited %s continuation policy after its %s owner has closed',
    async (entry, ownerEntry) => {
      // Given: a continuation inherits the first boundary but begins only after it settles.
      const release = deferred();
      const { drizzle, events } = nativeFixture();
      const failure = { rejected: true };
      const boundary: TransactionBoundaryOptions<typeof failure> = { shouldRollback: (value) => value.rejected };
      let continuation: Promise<typeof failure> | undefined;
      await drizzle[ownerEntry](async () => {
        continuation = release.promise.then(() => entry === 'transaction'
          ? drizzle.transaction(async () => failure, undefined, boundary)
          : drizzle.requestTransaction(async () => failure, undefined, undefined, boundary));
      });
      if (!continuation) {
        throw new Error('Inherited continuation was not created.');
      }

      // When: the continuation enters a fresh root with its own application policy.
      release.resolve();
      await expect(continuation).resolves.toBe(failure);

      // Then: its policy does not disappear while leaving the closed ALS owner.
      expect(events).toEqual(['begin:1', 'commit:1', 'begin:2', 'rollback:2']);
    },
  );

  it.each([false, true])('preflights unsupported root boundaries with strictTransactions=%s', async (strictTransactions) => {
    // Given: a database without native transaction support and an explicit rollback policy.
    const drizzle = new DrizzleDatabase({}, undefined, { strictTransactions , rollbackObserver: observerDouble});
    let calls = 0;
    const callback = async () => { calls += 1; return 0; };
    const boundary: TransactionBoundaryOptions<number> = { shouldRollback: () => true };
    class Service {
      readonly db = drizzle;
      @Transaction(undefined, undefined, boundary)
      async run() { return callback(); }
    }

    // When: each public root entry point requests native Result rollback.
    await expect(drizzle.transaction(callback, undefined, boundary)).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    await expect(drizzle.requestTransaction(callback, undefined, undefined, boundary)).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    await expect(new Service().run()).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);

    // Then: capability failure precedes callbacks in both strict and fail-open configurations.
    expect(calls).toBe(0);
  });

  it.each(['transaction', 'requestTransaction'] as const)(
    'rejects opted-in children inside a %s fail-open owner before their work',
    async (entry) => {
      // Given: an ordinary fail-open owner, with no native rollback capability.
      const drizzle = new DrizzleDatabase({}, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
      let calls = 0;
      const callback = async () => { calls += 1; return false; };
      const boundary: TransactionBoundaryOptions<boolean> = { shouldRollback: () => true };

      // When: nested manual and request boundaries independently opt in.
      await drizzle[entry](async () => {
        await expect(drizzle.transaction(callback, undefined, boundary)).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
        await expect(drizzle.requestTransaction(callback, undefined, undefined, boundary)).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
      });

      // Then: fallback remains available to its owner without claiming rollback for children.
      expect(calls).toBe(0);
    },
  );

  it.each(['implicit', 'explicit'] as const)(
    'rejects a legacy %s decorator target before invoking its runner or callback',
    async (entry) => {
      // Given: a structural legacy target even exposes afterCommit, but owns no Fluo Result boundary.
      let callbacks = 0;
      let nativeCalls = 0;
      class Service {
        readonly db = {
          afterCommit() {},
          async transaction<T>(callback: () => Promise<T>): Promise<T> {
            nativeCalls += 1;
            return callback();
          },
        };
        @Transaction(undefined, undefined, { shouldRollback: (value: number) => value < 0 })
        async implicit() { callbacks += 1; return -1; }
        @Transaction((self: Service) => self.db, undefined, { shouldRollback: (value: number) => value < 0 })
        async explicit() { callbacks += 1; return -1; }
      }

      // When: the selected target cannot guarantee the new opt-in policy.
      await expect(new Service()[entry]()).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);

      // Then: neither structural compatibility nor afterCommit silently enables Result rollback.
      expect(callbacks).toBe(0);
      expect(nativeCalls).toBe(0);
    },
  );

  it.each(['transaction', 'requestTransaction'] as const)(
    'rejects nested request native options under a %s owner without running its policy',
    async (entry) => {
      // Given: native options cannot reconfigure an already active owner.
      const { drizzle, events } = nativeFixture();
      let calls = 0;
      let evaluations = 0;

      // When: a child supplies native options together with a separate Fluo policy.
      await drizzle[entry](async () => {
        await expect(drizzle.requestTransaction(
          async () => { calls += 1; return 0; },
          undefined,
          { isolationLevel: 'serializable' },
          { shouldRollback: () => { evaluations += 1; return true; } },
        )).rejects.toThrow('Nested Drizzle transaction options are not supported');
      });

      // Then: the canonical options restriction wins before work or policy evaluation.
      expect(calls).toBe(0);
      expect(evaluations).toBe(0);
      expect(events).toEqual(['begin:1', 'commit:1']);
    },
  );

  it('preserves native option positions and inferred provider, facade, and decorator result types', async () => {
    // Given: an explicitly typed native driver and an application-owned failure shape.
    type Options = { readonly isolationLevel: 'serializable' };
    const options: Options = { isolationLevel: 'serializable' };
    const failure = { rejected: true, code: 409 };
    const recorded: (Options | undefined)[] = [];
    const database = {
      async transaction<T>(callback: (handle: object) => Promise<T>, native?: Options): Promise<T> {
        recorded.push(native);
        return callback({});
      },
    };
    const drizzle = DrizzleDatabase.createFacade<typeof database, object, Options>(database, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    const provider: DrizzleHandleProvider<typeof database, object, Options> = drizzle;
    const boundary: TransactionBoundaryOptions<typeof failure> = { shouldRollback: (value) => value.rejected };
    class Service {
      readonly db = drizzle;
      @Transaction((self: Service) => self.db, options, boundary)
      async accessor() { return failure; }
      @Transaction(options, undefined, boundary)
      async nativeFirst() { return failure; }
      @Transaction(undefined, options, boundary)
      async ignoredSecondWithoutAccessor() { return failure; }
    }
    const service = new Service();

    // When: native options and Fluo policies occupy their existing separate positions.
    const manual = provider.transaction(async () => failure, options, {
      shouldRollback: (value) => {
        expectTypeOf(value).toEqualTypeOf<typeof failure>();
        return value.rejected;
      },
    });
    expectTypeOf(manual).toEqualTypeOf<Promise<typeof failure>>();
    await expect(manual).resolves.toBe(failure);
    const request = provider.requestTransaction(async () => failure, undefined, options, {
      shouldRollback: (value) => {
        expectTypeOf(value).toEqualTypeOf<typeof failure>();
        return value.rejected;
      },
    });
    expectTypeOf(request).toEqualTypeOf<Promise<typeof failure>>();
    await expect(request).resolves.toBe(failure);
    expectTypeOf(service.accessor).returns.toEqualTypeOf<Promise<typeof failure>>();
    await expect(service.accessor()).resolves.toBe(failure);
    await expect(service.nativeFirst()).resolves.toBe(failure);
    await expect(service.ignoredSecondWithoutAccessor()).resolves.toBe(failure);

    // Then: policies never enter the native argument, including accessor-only second options.
    expect(recorded).toEqual([options, options, options, options, undefined]);
    expect(recorded.slice(0, 4).every((value) => value === options)).toBe(true);
    expectTypeOf(new TransactionRollbackOnlyError(failure).result).toEqualTypeOf<unknown>();
  });
});
