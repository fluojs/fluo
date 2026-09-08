import { describe, expect, it } from 'vitest';

import { DrizzleDatabase } from '../../packages/drizzle/src/index.js';
import { MongooseConnection } from '../../packages/mongoose/src/index.js';
import { PrismaService } from '../../packages/prisma/src/index.js';

// A controllable native boundary seam, not evidence of real database integration.
// The companion packages/prisma/fixtures/after-commit harness runs native drivers.
function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

class NativeBoundary {
  readonly events: string[] = [];
  commitError?: Error;
  beforeCommit?: () => Promise<void>;

  async run<T>(callback: () => Promise<T>): Promise<T> {
    this.events.push('start');
    try {
      const result = await callback();
      await this.commit();
      return result;
    } catch (error) {
      this.events.push('rollback');
      throw error;
    }
  }

  async commit(): Promise<void> {
    await this.beforeCommit?.();
    if (this.commitError) {
      throw this.commitError;
    }
    this.events.push('commit');
  }

  session() {
    return {
      startTransaction: async () => { this.events.push('start'); },
      commitTransaction: () => this.commit(),
      abortTransaction: async () => { this.events.push('rollback'); },
      endSession: async () => { this.events.push('end'); },
    };
  }
}

interface Boundary {
  afterCommit(callback: () => void | Promise<void>): void;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  requestTransaction<T>(callback: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  onApplicationShutdown(): Promise<void>;
  isRoot(): boolean;
}

const factories: readonly { readonly name: string; readonly create: (native: NativeBoundary) => Boundary }[] = [
  {
    name: 'Prisma',
    create(native) {
      const root = {
        $transaction: <T>(callback: (client: object) => Promise<T>) => native.run(() => callback({})),
        $disconnect: async () => { native.events.push('dispose'); },
      };
      const wrapper = new PrismaService(root);
      return {
        afterCommit: (callback) => wrapper.afterCommit(callback),
        transaction: (callback) => wrapper.transaction(callback),
        requestTransaction: (callback, signal) => wrapper.requestTransaction(callback, signal),
        onApplicationShutdown: () => wrapper.onApplicationShutdown(),
        isRoot: () => wrapper.current() === root,
      };
    },
  },
  {
    name: 'Drizzle',
    create(native) {
      const root = {
        transaction: <T>(callback: (client: object) => Promise<T>) => native.run(() => callback({})),
      };
      const wrapper = new DrizzleDatabase<typeof root, object>(root, async () => { native.events.push('dispose'); });
      return {
        afterCommit: (callback) => wrapper.afterCommit(callback),
        transaction: (callback) => wrapper.transaction(callback),
        requestTransaction: (callback, signal) => wrapper.requestTransaction(callback, signal),
        onApplicationShutdown: () => wrapper.onApplicationShutdown(),
        isRoot: () => wrapper.current() === root,
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
            const session = native.session();
            try {
              return await native.run(() => callback(session));
            } finally {
              await session.endSession();
            }
          },
        };
      const wrapper = new MongooseConnection(root, async () => { native.events.push('dispose'); });
      return {
        afterCommit: (callback) => wrapper.afterCommit(callback),
        transaction: (callback) => wrapper.transaction(callback),
        requestTransaction: (callback, signal) => wrapper.requestTransaction(callback, signal),
        onApplicationShutdown: () => wrapper.onApplicationShutdown(),
        isRoot: () => wrapper.currentSession() === undefined,
      };
    },
  })),
];

describe.each(factories)('$name shared afterCommit contract', ({ create }) => {
  it('drains registered hooks when cancellation races with a successful native commit', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const commitStarted = barrier();
    const commitReleased = barrier();
    const controller = new AbortController();
    native.beforeCommit = async () => {
      commitStarted.release();
      await commitReleased.promise;
    };
    const transaction = wrapper.requestTransaction(async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      return 'committed';
    }, controller.signal);
    const observed = transaction.then(
      (value) => ({ status: 'fulfilled', value }),
      (reason: unknown) => ({ status: 'rejected', reason }),
    );
    try {
      await commitStarted.promise;
      controller.abort(new Error('abort during commit'));
      commitReleased.release();
      expect(await observed).toEqual({ status: 'fulfilled', value: 'committed' });
      expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'hook']);
    } finally {
      commitReleased.release();
      await observed;
    }
  });

  it('does not observe transactions opened directly on the native client', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    await native.run(async () => {
      expect(() => wrapper.afterCommit(() => {})).toThrow();
      expect(wrapper.isRoot()).toBe(true);
    });
  });

  it('awaits asynchronous FIFO hooks after commit and reuses the nested owner', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const hookStarted = barrier();
    const hookReleased = barrier();
    const transaction = wrapper.transaction(async () => {
      wrapper.afterCommit(async () => {
        expect(wrapper.isRoot()).toBe(true);
        native.events.push('first');
        hookStarted.release();
        await hookReleased.promise;
        native.events.push('first-done');
      });
      await wrapper.requestTransaction(async () => {
        wrapper.afterCommit(() => { native.events.push('second'); });
      });
      expect(native.events).toEqual(['start']);
      return 42;
    });
    try {
      await hookStarted.promise;
      expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'first']);
      hookReleased.release();
      expect(await transaction).toBe(42);
      expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'first', 'first-done', 'second']);
    } finally {
      hookReleased.release();
      await Promise.allSettled([transaction]);
    }
  });

  it('discards hooks when the callback throws', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const failure = new Error('callback failure');

    await expect(wrapper.transaction(async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      throw failure;
    })).rejects.toBe(failure);

    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'rollback']);
    expect(wrapper.isRoot()).toBe(true);
  });

  it('follows the final commit when a nested throw is caught without a savepoint', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const nestedFailure = new Error('caught nested failure');

    await wrapper.transaction(async () => {
      try {
        await wrapper.transaction(async () => {
          wrapper.afterCommit(() => { native.events.push('nested-hook'); });
          throw nestedFailure;
        });
      } catch (error) {
        expect(error).toBe(nestedFailure);
      }
      wrapper.afterCommit(() => { native.events.push('outer-hook'); });
    });

    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'nested-hook', 'outer-hook']);
  });

  it('isolates concurrent owners even when the second commits first', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const firstStarted = barrier();
    const firstReleased = barrier();
    const hooks: string[] = [];
    const first = wrapper.transaction(async () => {
      wrapper.afterCommit(() => { hooks.push('first'); });
      firstStarted.release();
      await firstReleased.promise;
    });
    try {
      await firstStarted.promise;
      await wrapper.transaction(async () => {
        wrapper.afterCommit(() => { hooks.push('second'); });
      });
      expect(hooks).toEqual(['second']);
      firstReleased.release();
      await first;
      expect(hooks).toEqual(['second', 'first']);
    } finally {
      firstReleased.release();
      await Promise.allSettled([first]);
    }
  });

  it('discards hooks when the native commit fails', async () => {
    const native = new NativeBoundary();
    native.commitError = new Error('native commit failure');
    const wrapper = create(native);

    await expect(wrapper.transaction(async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
    })).rejects.toBe(native.commitError);

    expect(native.events).not.toContain('hook');
    expect(native.events).not.toContain('commit');
    expect(wrapper.isRoot()).toBe(true);
  });

  it('discards hooks when an active request is aborted', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const controller = new AbortController();
    const started = barrier();
    const released = barrier();
    const transaction = wrapper.requestTransaction(async () => {
      wrapper.afterCommit(() => { native.events.push('hook'); });
      started.release();
      await released.promise;
    }, controller.signal);
    const rejected = expect(transaction).rejects.toThrow('cancel request');
    try {
      await started.promise;
      controller.abort(new Error('cancel request'));
      released.release();
      await rejected;
      expect(native.events).not.toContain('hook');
      expect(native.events).not.toContain('commit');
    } finally {
      released.release();
      await Promise.allSettled([transaction]);
    }
  });

  it('collects all hook outcomes without rollback or native retry', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const firstError = new Error('first hook failure');
    const lastError = new Error('last hook failure');

    await expect(wrapper.transaction(async () => {
      wrapper.afterCommit(() => { throw firstError; });
      wrapper.afterCommit(async () => { native.events.push('middle-hook'); });
      wrapper.afterCommit(async () => { throw lastError; });
    })).rejects.toMatchObject({
      name: 'AfterCommitError',
      committed: true,
      errors: [firstError, lastError],
      results: [
        { status: 'rejected', reason: firstError },
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: lastError },
      ],
    });
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'middle-hook']);
  });

  it.each(['manual', 'request'])('drains %s boundary hooks before shutdown disposal', async (boundary) => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const hookStarted = barrier();
    const hookReleased = barrier();
    const callback = async () => {
      wrapper.afterCommit(async () => {
        native.events.push('hook');
        hookStarted.release();
        await hookReleased.promise;
        native.events.push('hook-done');
      });
    };
    const transaction = boundary === 'manual' ? wrapper.transaction(callback) : wrapper.requestTransaction(callback);
    let shutdown: Promise<void> | undefined;
    try {
      await hookStarted.promise;
      shutdown = wrapper.onApplicationShutdown();
      expect(native.events).not.toContain('dispose');
      await expect(wrapper.transaction(async () => {})).rejects.toThrow();
      hookReleased.release();
      await transaction;
      await shutdown;
      expect(native.events.slice(-2)).toEqual(['hook-done', 'dispose']);
      expect(native.events).not.toContain('rollback');
      expect(() => wrapper.afterCommit(() => {})).toThrow();
    } finally {
      hookReleased.release();
      await Promise.allSettled([transaction, shutdown]);
    }
  });

  it('opens a fresh native owner from an inherited ended scope', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const released = barrier();
    let late: Promise<void> | undefined;
    await wrapper.transaction(async () => {
      late = released.promise.then(() => wrapper.transaction(async () => {
        expect(wrapper.isRoot()).toBe(false);
        wrapper.afterCommit(() => { native.events.push('fresh-hook'); });
      }));
    });
    released.release();
    await late;
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'start', 'commit', 'fresh-hook']);
  });

  it('rejects late registration in inherited contexts and creates a fresh owner from a hook', async () => {
    const native = new NativeBoundary();
    const wrapper = create(native);
    const released = barrier();
    let late: Promise<void> | undefined;
    await wrapper.transaction(async () => {
      late = released.promise.then(() => {
        expect(wrapper.isRoot()).toBe(true);
        expect(() => wrapper.afterCommit(() => {})).toThrow();
      });
      wrapper.afterCommit(async () => {
        expect(wrapper.isRoot()).toBe(true);
        expect(() => wrapper.afterCommit(() => {})).toThrow();
        await wrapper.transaction(async () => {
          wrapper.afterCommit(() => { native.events.push('fresh-hook'); });
        });
      });
    });
    released.release();
    await late;
    expect(native.events.filter((event) => event !== 'end')).toEqual(['start', 'commit', 'start', 'commit', 'fresh-hook']);
  });
});
