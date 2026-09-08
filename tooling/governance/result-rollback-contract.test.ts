import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { DrizzleDatabase } from '../../packages/drizzle/src/index.js';
import { MongooseConnection, TransactionRollbackOnlyError as MongooseRollbackOnlyError } from '../../packages/mongoose/src/index.js';
import { PrismaService } from '../../packages/prisma/src/index.js';

interface Policy<T> {
  readonly requireAfterCommit?: boolean;
  readonly shouldRollback?: (value: T) => boolean;
}

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Controllable native boundary, not a substitute for the PostgreSQL/Mongo fixture.
class NativeBoundary {
  readonly events: string[] = [];
  private readonly observations = new AsyncLocalStorage<{ confirmed: boolean }>();
  readonly observer = {
    run: <T>(callback: () => Promise<T>): Promise<T> => this.observations.run({ confirmed: false }, callback),
    beginAttempt: () => {
      const state = this.observations.getStore();
      if (!state) throw new Error('Native observation must begin before callbacks.');
      state.confirmed = false;
      return { confirmRollback: async () => {
        await this.beforeConfirmation?.();
        if (this.confirmationError) throw this.confirmationError;
        if (!state.confirmed) throw new Error('Native rollback was not confirmed.');
        return true as const;
      } };
    },
  };
  confirmationError?: Error;
  beforeConfirmation?: () => Promise<void>;
  rollbackError?: Error;
  commitError?: Error;
  beforeRollback?: () => Promise<void>;

  async run<T>(callback: () => Promise<T>): Promise<T> {
    this.events.push('start');
    try {
      const value = await callback();
      await this.commit();
      return value;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (this.commitError) throw this.commitError;
    this.events.push('commit');
  }

  async rollback(): Promise<void> {
    this.events.push('rollback-start');
    await this.beforeRollback?.();
    if (this.rollbackError) throw this.rollbackError;
    this.events.push('rollback-done');
    const state = this.observations.getStore();
    if (state) state.confirmed = true;
  }

  session() {
    return {
      startTransaction: async () => { this.events.push('start'); },
      commitTransaction: () => this.commit(),
      abortTransaction: () => this.rollback(),
      endSession: async () => { this.events.push('end'); },
    };
  }
}

interface Boundary {
  transaction<T>(fn: () => Promise<T>, policy?: Policy<T>): Promise<T>;
  requestTransaction<T>(fn: () => Promise<T>, policy?: Policy<T>): Promise<T>;
  afterCommit(fn: () => void | Promise<void>): void;
  shutdown(): Promise<void>;
}

const factories: readonly {
  readonly name: string;
  readonly create: (native: NativeBoundary) => Boundary;
}[] = [
  {
    name: 'Prisma',
    create(native) {
      const wrapper = new PrismaService({
        $transaction: <T>(callback: (client: object) => Promise<T>) => native.run(() => callback({})),
      }, { strictTransactions: false, rollbackObserver: native.observer });
      return {
        transaction: (fn, policy) => wrapper.transaction(fn, undefined, policy),
        requestTransaction: (fn, policy) => wrapper.requestTransaction(fn, undefined, undefined, policy),
        afterCommit: (fn) => wrapper.afterCommit(fn),
        shutdown: () => wrapper.onApplicationShutdown(),
      };
    },
  },
  {
    name: 'Drizzle',
    create(native) {
      const root = { transaction: <T>(callback: (client: object) => Promise<T>) => native.run(() => callback({})) };
      const wrapper = new DrizzleDatabase<typeof root, object>(root, undefined, { strictTransactions: false, rollbackObserver: native.observer });
      return {
        transaction: (fn, policy) => wrapper.transaction(fn, undefined, policy),
        requestTransaction: (fn, policy) => wrapper.requestTransaction(fn, undefined, undefined, policy),
        afterCommit: (fn) => wrapper.afterCommit(fn),
        shutdown: () => wrapper.onApplicationShutdown(),
      };
    },
  },
  ...['manual', 'delegated'].map((strategy) => ({
    name: `Mongoose ${strategy}`,
    create(native: NativeBoundary): Boundary {
      const root = strategy === 'manual'
        ? { startSession: async () => native.session() }
        : {
          async transaction<T>(callback: (session: ReturnType<NativeBoundary['session']>) => Promise<T>): Promise<T> {
            try {
              return await native.run(() => callback(native.session()));
            } finally {
              native.events.push('end');
            }
          },
        };
      const wrapper = new MongooseConnection(root, undefined, { strictTransactions: false, rollbackObserver: native.observer });
      return {
        transaction: (fn, policy) => wrapper.transaction(fn, policy),
        requestTransaction: (fn, policy) => wrapper.requestTransaction(fn, undefined, policy),
        afterCommit: (fn) => wrapper.afterCommit(fn),
        shutdown: () => wrapper.onApplicationShutdown(),
      };
    },
  })),
];

describe.each(factories)('$name opt-in Result rollback', ({ name, create }) => {
  it.each(['transaction', 'requestTransaction'] as const)('rolls back a root failure before %s returns its identity', async (entry) => {
    // Given: an explicit domain predicate, not a global Result convention.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const failure = { ok: false, reason: 'domain rejection' };
    const policy = { requireAfterCommit: true, shouldRollback: (value: typeof failure) => !value.ok };
    // When: a resolved failure leaves the owning callback.
    const result = await wrapper[entry](async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      return failure;
    }, policy);
    // Then: rollback completes before return and the hook is discarded.
    expect(result).toBe(failure);
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'rollback-start', 'rollback-done']);
  });

  it.each(['transaction', 'requestTransaction'] as const)('waits for native rollback before settling %s or shutdown', async (entry) => {
    // Given: rollback is blocked by an exact lifecycle event, not a delay.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const started = barrier();
    const released = barrier();
    native.beforeRollback = async () => { started.resolve(); await released.promise; };
    let returned = false;
    let stopped = false;
    const failure = { ok: false };
    // When: the root resolves a failure, then shutdown joins the native boundary.
    const transaction = wrapper[entry](async () => failure, { shouldRollback: () => true }).then((value) => {
      returned = true;
      return value;
    });
    let shutdown: Promise<void> | undefined;
    try {
      await started.promise;
      shutdown = wrapper.shutdown().then(() => { stopped = true; });
      // Then: neither public completion can precede native rollback.
      expect(returned).toBe(false);
      expect(stopped).toBe(false);
      released.resolve();
      expect(await transaction).toBe(failure);
      await shutdown;
      expect(stopped).toBe(true);
    } finally {
      released.resolve();
      await Promise.allSettled([transaction, shutdown]);
    }
  });

  it.each(['transaction', 'requestTransaction'] as const)('does not turn native rollback failure into a resolved %s result', async (entry) => {
    // Given: the native runner reports rollback failure.
    const native = new NativeBoundary();
    native.rollbackError = new Error('native rollback failed');
    const wrapper = create(native);
    // When / Then: the real reported error wins over the domain result.
    const pending = wrapper[entry](async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      return false;
    }, { shouldRollback: () => true });
    if (name === 'Mongoose manual') {
      // The manual owner preserves both the callback signal and native abort
      // failure, unlike delegated runners that expose only their rejection.
      const [outcome] = await Promise.allSettled([pending]);
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('Native rollback failure was hidden.');
      expect(outcome.reason).toBeInstanceOf(AggregateError);
      expect(outcome.reason.errors).toHaveLength(2);
      expect(outcome.reason.errors[0]).toBeInstanceOf(MongooseRollbackOnlyError);
      expect(outcome.reason.errors[0].result).toBe(false);
      expect(outcome.reason.errors[1]).toBe(native.rollbackError);
      expect(outcome.reason.cause).toBe(outcome.reason.errors[0]);
    } else {
      await expect(pending).rejects.toBe(native.rollbackError);
    }
    expect(native.events).not.toContain('hook');
    expect(native.events).not.toContain('commit');
  });

  it.each(['transaction', 'requestTransaction'] as const)('does not settle %s or shutdown before positive observation completes', async (entry) => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const entered = barrier();
    const release = barrier();
    native.beforeConfirmation = async () => { entered.resolve(); await release.promise; };
    let returned = false;
    let stopped = false;
    const pending = wrapper[entry](async () => false, { shouldRollback: () => true }).then((value) => {
      returned = true;
      return value;
    });
    let shutdown: Promise<void> | undefined;
    try {
      await entered.promise;
      shutdown = wrapper.shutdown().then(() => { stopped = true; });
      expect(native.events).toContain('rollback-done');
      expect(returned).toBe(false);
      expect(stopped).toBe(false);
      release.resolve();
      await expect(pending).resolves.toBe(false);
      await shutdown;
    } finally {
      release.resolve();
      await Promise.allSettled([pending, shutdown]);
    }
  });

  it('propagates an independently observed rollback failure despite the native sentinel', async () => {
    const native = new NativeBoundary();
    native.confirmationError = new Error('independently observed native failure');
    const wrapper = create(native);
    await expect(wrapper.transaction(async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      return false;
    }, { shouldRollback: () => true })).rejects.toBe(native.confirmationError);
    expect(native.events).not.toContain('hook');
  });

  it('rejects missing positive confirmation instead of accepting a malformed observer', async () => {
    const native = new NativeBoundary();
    Reflect.set(native.observer, 'beginAttempt', () => ({ confirmRollback() {} }));
    const wrapper = create(native);
    await expect(wrapper.transaction(async () => false, { shouldRollback: () => true }))
      .rejects.toMatchObject({ name: 'TransactionRollbackUnconfirmedError' });
  });

  it.each(['transaction', 'requestTransaction'] as const)('propagates commit errors for opted-in successful %s results', async (entry) => {
    // Given: a successful domain value and an unsuccessful native commit.
    const native = new NativeBoundary();
    native.commitError = new Error('native commit failed');
    const wrapper = create(native);
    // When / Then: the successful value cannot hide native failure.
    await expect(wrapper[entry](async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      return { ok: true };
    }, { shouldRollback: (value) => !value.ok })).rejects.toBe(native.commitError);
    expect(native.events).not.toContain('hook');
  });

  it.each(['transaction', 'requestTransaction'] as const)('commits successful root and nested policies through %s', async (entry) => {
    // Given: both predicates accept success in the same native owner.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const success = { ok: true };
    const policy = { shouldRollback: (value: typeof success) => !value.ok };
    // When: both entry points nest inside the selected root.
    const result = await wrapper[entry](async () => {
      wrapper.afterCommit(() => { native.events.push('root-hook'); });
      await wrapper.transaction(async () => success, policy);
      await wrapper.requestTransaction(async () => {
        wrapper.afterCommit(() => { native.events.push('nested-hook'); });
        return success;
      }, policy);
      return success;
    }, policy);
    // Then: success identity and one shared commit are preserved.
    expect(result).toBe(success);
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'root-hook', 'nested-hook']);
  });

  for (const outer of ['transaction', 'requestTransaction'] as const) {
    it.each(['transaction', 'requestTransaction'] as const)(`rejects an ignored inner %s failure at the ${outer} owner`, async (inner) => {
      // Given: the first inner failure must survive another inner failure and a successful outer return.
      const native = new NativeBoundary();
      const wrapper = create(native);
      const failure = { ok: false, reason: 'first' };
      // When: application code explicitly ignores the nested failure.
      const transaction = wrapper[outer](async () => {
        const nested = await wrapper[inner](async () => {
          wrapper.afterCommit(() => { native.events.push('nested-hook'); });
          return failure;
        }, { shouldRollback: (value) => !value.ok });
        expect(nested).toBe(failure);
        await wrapper[inner](async () => ({ ok: false, reason: 'second' }), { shouldRollback: () => true });
        wrapper.afterCommit(() => { native.events.push('outer-hook'); });
        return { ok: true };
      });
      // Then: no success is fabricated; the original nested value is retained as evidence.
      await expect(transaction).rejects.toMatchObject({ name: 'TransactionRollbackOnlyError', result: failure });
      expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'rollback-start', 'rollback-done']);
    });
  }

  it('returns the outer failure identity when its own predicate also requests rollback', async () => {
    // Given: nested and outer Result types differ.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const outerFailure = { success: false, reason: 'converted outer failure' };
    // When: the outer policy explicitly marks its converted failure.
    const result = await wrapper.transaction(async () => {
      await wrapper.requestTransaction(async () => false, { shouldRollback: (value) => !value });
      return outerFailure;
    }, { shouldRollback: (value) => !value.success });
    // Then: type and identity are the root callback's, not the nested value's.
    expect(result).toBe(outerFailure);
    expect(native.events).not.toContain('commit');
  });

  it.each([{ ok: false }, false, { status: 500 }, undefined, null, 0])('keeps ordinary resolved %j values opaque', async (value) => {
    // Given: no policy, even though the values could look like business failures.
    const native = new NativeBoundary();
    const wrapper = create(native);
    // When: arbitrary values flow through nested boundaries.
    const result = await wrapper.transaction(async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      return wrapper.requestTransaction(async () => value);
    });
    // Then: the original contract commits and returns the value unchanged.
    expect(result).toBe(value);
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'hook']);
  });

  it('preserves caught ordinary nested throws inside an opted-in successful owner', async () => {
    // Given: nested reuse is not a savepoint and exceptions are not sticky Result failures.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const failure = new Error('ordinary nested exception');
    // When: the owner catches an ordinary nested throw, then returns success.
    const value = await wrapper.transaction(async () => {
      await expect(wrapper.requestTransaction(async () => {
        wrapper.afterCommit(() => { native.events.push('nested-hook'); });
        throw failure;
      })).rejects.toBe(failure);
      return true;
    }, { shouldRollback: (result) => !result });
    // Then: the shared writes/hooks still follow the outer commit.
    expect(value).toBe(true);
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'nested-hook']);
  });

  it('propagates a throwing predicate as an error rather than a Result', async () => {
    // Given: policy code itself fails.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const error = new Error('predicate failed');
    // When / Then: errors escaping the callback trigger native rollback.
    await expect(wrapper.transaction(async () => 42, { shouldRollback: () => { throw error; } })).rejects.toBe(error);
    expect(native.events).not.toContain('commit');
  });

  it('isolates overlapping success and rollback-only owners', async () => {
    // Given: the failing owner is suspended after its nested policy runs.
    const native = new NativeBoundary();
    const wrapper = create(native);
    const started = barrier();
    const released = barrier();
    const hooks: string[] = [];
    const first = wrapper.transaction(async () => {
      await wrapper.transaction(async () => false, { shouldRollback: () => true });
      wrapper.afterCommit(() => { hooks.push('failed'); });
      started.resolve();
      await released.promise;
      return false;
    }, { shouldRollback: () => true });
    try {
      await started.promise;
      // When: an independent request owner commits first.
      await wrapper.requestTransaction(async () => {
        wrapper.afterCommit(() => { hooks.push('success'); });
        return true;
      }, { shouldRollback: (value) => !value });
      released.resolve();
      // Then: only the failing owner rolls back; its hooks cannot leak.
      expect(await first).toBe(false);
      expect(hooks).toEqual(['success']);
      expect(native.events.filter((event) => event === 'commit')).toHaveLength(1);
      expect(native.events.filter((event) => event === 'rollback-done')).toHaveLength(1);
    } finally {
      released.resolve();
      await Promise.allSettled([first]);
    }
  });
});
