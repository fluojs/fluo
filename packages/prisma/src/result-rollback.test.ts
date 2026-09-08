import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type PrismaHandleProvider,
  PrismaService,
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

type Result = { readonly ok: boolean; readonly id: string };
const policy: TransactionBoundaryOptions<Result> = { shouldRollback: (value) => !value.ok };

describe('Prisma Result policy public seam', () => {
  it('preserves native options and inferred Result types through service, request, and decorator boundaries', async () => {
    // Given: native options have their own typed input, apart from the Fluo policy.
    const options = { isolationLevel: 'Serializable' as const, timeout: 5000 };
    const received: unknown[] = [];
    const events: string[] = [];
    const root = {
      async $transaction<T>(fn: (client: object) => Promise<T>, native?: typeof options): Promise<T> {
        received.push(native);
        try {
          const result = await fn({});
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    };
    const wrapper: PrismaHandleProvider<typeof root> = new PrismaService(root, { strictTransactions: false, rollbackObserver: observerDouble });
    const failure: Result = { ok: false, id: 'post-3718' };
    class Service {
      constructor(readonly prisma = wrapper) {}

      @Transaction(options, policy)
      async save(): Promise<Result> { return failure; }

      @Transaction(() => wrapper, policy)
      async selected(): Promise<Result> { return failure; }
    }
    // When: all public entry points explicitly choose Result rollback.
    const direct = wrapper.transaction(async () => failure, options, {
      shouldRollback: (value) => {
        expectTypeOf(value).toEqualTypeOf<Result>();
        return !value.ok;
      },
    });
    expectTypeOf(direct).toEqualTypeOf<Promise<Result>>();
    expect(await direct).toBe(failure);
    expect(await wrapper.requestTransaction(async () => failure, undefined, options, policy)).toBe(failure);
    expect(await new Service().save()).toBe(failure);
    expect(await new Service().selected()).toBe(failure);
    // Then: only native options cross the native seam; return identity stays unchanged.
    expect(received[0]).toBe(options);
    expect(received[1]).toMatchObject(options);
    expect(received[1]).not.toHaveProperty('shouldRollback');
    expect(received[1]).not.toHaveProperty('requireAfterCommit');
    expect(received[2]).toBe(options);
    expect(received[3]).toBeUndefined();
    expect(events).toEqual(['rollback', 'rollback', 'rollback', 'rollback']);
  });

  it('refuses opt-in fallback and legacy decorator targets before executing callbacks', async () => {
    // Given: a fail-open wrapper and a pre-policy target cannot own rollback.
    const wrapper = new PrismaService({ $connect: async () => {} }, { strictTransactions: false, rollbackObserver: observerDouble });
    let calls = 0;
    const callback = async () => { calls += 1; return false; };
    const boundary = { shouldRollback: (value: boolean) => !value };
    const legacy = {
      afterCommit() {},
      current: () => ({}),
      createPlatformStatusSnapshot: () => ({}),
      transaction: <T>(fn: () => Promise<T>) => fn(),
    };
    class Service {
      @Transaction(() => wrapper, boundary)
      async save() { return callback(); }

      @Transaction(() => legacy, boundary)
      async legacy() { return callback(); }
    }
    // When / Then: every opt-in route fails before application work.
    await expect(wrapper.transaction(callback, undefined, boundary)).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    await expect(wrapper.requestTransaction(callback, undefined, undefined, boundary)).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    await expect(new Service().save()).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    await expect(new Service().legacy()).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    expect(calls).toBe(0);
    expect(await wrapper.transaction(callback)).toBe(false);
  });

  it('retains the first nested failure across an outer success policy and decorator reuse', async () => {
    // Given: all methods share one Prisma owner.
    let commits = 0;
    const wrapper = new PrismaService({
      async $transaction<T>(fn: (client: object) => Promise<T>): Promise<T> {
        const result = await fn({});
        commits += 1;
        return result;
      },
    }, { strictTransactions: false, rollbackObserver: observerDouble });
    const failure: Result = { ok: false, id: 'nested' };
    class Service {
      @Transaction(() => wrapper, policy)
      async save() { return failure; }
    }
    // When: the root explicitly reports success despite the failed nested decorator.
    const transaction = wrapper.requestTransaction(async () => {
      expect(await new Service().save()).toBe(failure);
      return { ok: true, id: 'root' };
    }, undefined, undefined, policy);
    // Then: the public error carries the failure rather than fabricating success.
    await expect(transaction).rejects.toBeInstanceOf(TransactionRollbackOnlyError);
    await expect(transaction).rejects.toMatchObject({ result: failure });
    expect(commits).toBe(0);
    expectTypeOf<TransactionRollbackOnlyError['result']>().toEqualTypeOf<unknown>();
  });

  it('keeps nested native options rejected instead of confusing them with policy options', async () => {
    // Given: nested reuse cannot honor a second native option set.
    const wrapper = new PrismaService({
      $transaction: <T>(fn: (client: object) => Promise<T>, _options?: { timeout: number }) => fn({}),
    }, { strictTransactions: false, rollbackObserver: observerDouble });
    let started = false;
    // When / Then: the original options rejection still precedes callback execution.
    await wrapper.transaction(async () => {
      await expect(wrapper.requestTransaction(async () => {
        started = true;
        return false;
      }, undefined, { timeout: 42 }, { shouldRollback: () => true })).rejects.toThrow('Nested Prisma transaction options');
    });
    expect(started).toBe(false);
  });

  it.each(['transaction', 'requestTransaction'] as const)('isolates native callback attempts in %s', async (entry) => {
    // Given: a native runner retries only its own known transient error.
    const transient = new Error('native retry');
    let attempts = 0;
    const hooks: string[] = [];
    const wrapper = new PrismaService({
      async $transaction<T>(fn: (client: object) => Promise<T>): Promise<T> {
        try {
          return await fn({});
        } catch (error) {
          if (error !== transient) throw error;
          return fn({});
        }
      },
    }, { strictTransactions: false, rollbackObserver: observerDouble });
    // When: the discarded attempt had both a nested policy failure and a hook.
    const fn = async () => {
      attempts += 1;
      const attempt = attempts;
      wrapper.afterCommit(() => { hooks.push(`attempt-${attempt}`); });
      if (attempt === 1) {
        await wrapper.transaction(async () => false, undefined, { shouldRollback: () => true });
        throw transient;
      }
      return true;
    };
    const value = entry === 'transaction'
      ? await wrapper.transaction(fn, undefined, { shouldRollback: (result) => !result })
      : await wrapper.requestTransaction(fn, undefined, undefined, { shouldRollback: (result) => !result });
    // Then: retry state is fresh and only the successful attempt's hook runs.
    expect(value).toBe(true);
    expect(attempts).toBe(2);
    expect(hooks).toEqual(['attempt-2']);
  });

  it('propagates native wrapping of the rollback signal rather than trusting a cause chain', async () => {
    // Given: the native runner reports failure while trying to roll back.
    let reported: Error | undefined;
    const wrapper = new PrismaService({
      async $transaction<T>(fn: (client: object) => Promise<T>): Promise<T> {
        try {
          return await fn({});
        } catch (cause) {
          reported = new Error('native rollback transport failure', { cause });
          throw reported;
        }
      },
    }, { strictTransactions: false, rollbackObserver: observerDouble });
    // When / Then: only an exact native-returned signal can become a normal Result.
    await expect(wrapper.transaction(async () => false, undefined, { shouldRollback: () => true }))
      .rejects.toMatchObject({ message: 'native rollback transport failure' });
    expect(reported?.cause).toBeInstanceOf(TransactionRollbackOnlyError);
  });
});
