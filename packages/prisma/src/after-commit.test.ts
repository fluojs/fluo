import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AfterCommitCallback,
  AfterCommitCapabilityError,
  type AfterCommitError,
  type PrismaHandleProvider,
  PrismaService,
  Transaction,
  type TransactionBoundaryOptions,
} from './index.js';

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('Prisma afterCommit', () => {
  it('awaits nested FIFO hooks only after the outer native commit', async () => {
    const events: string[] = [];
    const root = {
      async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
        const result = await callback({});
        events.push('commit');
        return result;
      },
    };
    const prisma = new PrismaService(root);

    const result = await prisma.transaction(async () => {
      prisma.afterCommit(async () => {
        expect(prisma.current()).toBe(root);
        events.push('first');
      });
      await prisma.transaction(async () => {
        prisma.afterCommit(() => { events.push('nested'); });
      });
      expect(events).toEqual([]);
      return 42;
    });

    expect(result).toBe(42);
    expect(events).toEqual(['commit', 'first', 'nested']);
  });

  it('supports public provider types and service/request composition', async () => {
    const events: string[] = [];
    const root = {
      async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
        const result = await callback({});
        events.push('commit');
        return result;
      },
    };
    const prisma: PrismaHandleProvider<typeof root> = new PrismaService(root);
    const boundary: TransactionBoundaryOptions = { requireAfterCommit: true };
    const hook: AfterCommitCallback = async () => { events.push('hook'); };

    class Service {
      @Transaction(() => prisma, boundary)
      async save() {
        prisma.afterCommit(hook);
        return 'saved';
      }
    }

    expectTypeOf(prisma.afterCommit).parameter(0).toEqualTypeOf<AfterCommitCallback>();
    expectTypeOf<AfterCommitError['committed']>().toEqualTypeOf<true>();
    expectTypeOf<AfterCommitError['results']>().toEqualTypeOf<readonly PromiseSettledResult<void>[]>();
    const result = await prisma.requestTransaction(() => new Service().save(), undefined, undefined, boundary);
    expect(result).toBe('saved');
    expect(events).toEqual(['commit', 'hook']);
  });

  it('rejects capability requirements before fallback callbacks for every entry point', async () => {
    const prisma = new PrismaService({ $connect: async () => {} });
    let started = false;
    const callback = async () => { started = true; };
    const boundary = { requireAfterCommit: true };
    class Service {
      @Transaction(() => prisma, boundary)
      async save() { await callback(); }
    }

    await expect(prisma.transaction(callback, undefined, boundary)).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    await expect(prisma.requestTransaction(callback, undefined, undefined, boundary)).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    await expect(new Service().save()).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    expect(started).toBe(false);
    await prisma.transaction(async () => {
      expect(() => prisma.afterCommit(() => {})).toThrow(AfterCommitCapabilityError);
    });
    await expect(prisma.transaction(async () => 42)).resolves.toBe(42);
  });

  it('rejects a legacy decorator target before it can ignore the commit requirement', async () => {
    let started = false;
    const legacy = {
      current: () => ({}),
      createPlatformStatusSnapshot: () => ({}),
      transaction: <T>(callback: () => Promise<T>) => callback(),
    };
    class Service {
      @Transaction(() => legacy, { requireAfterCommit: true })
      async save() { started = true; }
    }

    await expect(new Service().save()).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    expect(started).toBe(false);
  });

  it('rejects inherited late registration before commit and starts a fresh owner afterward', async () => {
    const commitStarted = barrier();
    const commitReleased = barrier();
    const continuationReleased = barrier();
    let continuation: Promise<void> | undefined;
    let nativeCalls = 0;
    const events: string[] = [];
    const root = {
      async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
        nativeCalls += 1;
        const result = await callback({});
        if (nativeCalls === 1) {
          commitStarted.release();
          await commitReleased.promise;
        }
        return result;
      },
    };
    const prisma = new PrismaService(root);
    let registerLate = () => {};
    const transaction = prisma.transaction(async () => {
      registerLate = () => prisma.afterCommit(() => { events.push('late'); });
      continuation = continuationReleased.promise.then(async () => {
        expect(prisma.current()).toBe(root);
        expect(registerLate).toThrow('active transaction callback');
        await prisma.transaction(async () => {
          prisma.afterCommit(() => { events.push('fresh'); });
        });
      });
      prisma.afterCommit(() => { events.push('first'); });
    });
    try {
      await commitStarted.promise;
      expect(registerLate).toThrow('active transaction callback');
      commitReleased.release();
      await transaction;
      continuationReleased.release();
      await continuation;
      expect(nativeCalls).toBe(2);
      expect(events).toEqual(['first', 'fresh']);
    } finally {
      commitReleased.release();
      continuationReleased.release();
      await Promise.allSettled([transaction, continuation]);
    }
  });

  it('does not retry a native transaction when a hook rejects with an unsupported-signal error', async () => {
    const hookError = new Error('Unknown argument signal');
    let nativeCalls = 0;
    const prisma = new PrismaService({
      async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
        nativeCalls += 1;
        return callback({});
      },
    });
    let lastHookRan = false;

    const operation = prisma.requestTransaction(async () => {
      prisma.afterCommit(() => { throw hookError; });
      prisma.afterCommit(async () => { lastHookRan = true; });
    });
    await expect(operation).rejects.toMatchObject({
      name: 'AfterCommitError',
      committed: true,
      errors: [hookError],
      results: [
        { status: 'rejected', reason: hookError },
        { status: 'fulfilled', value: undefined },
      ],
    });
    expect(nativeCalls).toBe(1);
    expect(lastHookRan).toBe(true);
  });
});
