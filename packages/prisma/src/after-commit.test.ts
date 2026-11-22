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

describe('Prisma @Transaction requireAfterCommit owner preflight', () => {
  it.each(['unbranded', 'incomplete'] as const)(
    'rejects a query-isolated copy-B decorator %s owner lookalike that supplies a callable afterCommit',
    async (kind) => {
      const copyB = await import(`${new URL('./transaction.ts', import.meta.url).href}?copy-b-negative`);
      let transactionCalls = 0;
      let methodCalls = 0;
      let afterCommitCalls = 0;
      let hookCalls = 0;
      const target = {
        afterCommit(callback: () => void) { afterCommitCalls += 1; callback(); },
        createPlatformStatusSnapshot() { return {}; },
        current() { return {}; },
        requestTransaction<T>(callback: () => Promise<T>) { return callback(); },
        transaction<T>(callback: () => Promise<T>) { transactionCalls += 1; return callback(); },
      };
      if (kind === 'incomplete') {
        Object.defineProperty(target, Symbol.for('@fluojs/prisma/PrismaService.owner'), { value: 1 });
        Reflect.deleteProperty(target, 'requestTransaction');
      }
      class Service {
        @copyB.Transaction(() => target, undefined, { requireAfterCommit: true })
        async run() {
          methodCalls += 1;
          target.afterCommit(() => { hookCalls += 1; });
          return 'ran';
        }
      }

      await expect(new Service().run()).rejects.toBeInstanceOf(AfterCommitCapabilityError);
      expect({ transactionCalls, methodCalls, afterCommitCalls, hookCalls }).toEqual({
        afterCommitCalls: 0,
        hookCalls: 0,
        methodCalls: 0,
        transactionCalls: 0,
      });
    },
  );

  it.each(['omitted', 'disabled'] as const)(
    'keeps the legacy copy-B lookalike allowed path when the requirement is %s',
    async (mode) => {
      const copyB = await import(`${new URL('./transaction.ts', import.meta.url).href}?copy-b-compat`);
      const nativeOptions = { timeout: 5000 };
      const received: Array<[unknown, unknown]> = [];
      let methodCalls = 0;
      const result = { ok: true };
      const target = {
        afterCommit() {},
        createPlatformStatusSnapshot() { return {}; },
        current() { return {}; },
        requestTransaction<T>(callback: () => Promise<T>) { return callback(); },
        transaction<T>(callback: () => Promise<T>, options?: unknown, boundary?: unknown) {
          received.push([options, boundary]);
          return callback();
        },
      };
      let receiver: Service | undefined;
      let receivedArgs: number[] | undefined;
      class Service {
        @copyB.Transaction(() => target, nativeOptions, mode === 'omitted' ? undefined : { requireAfterCommit: false })
        async run(value: number) {
          receiver = this;
          receivedArgs = [value];
          methodCalls += 1;
          return result;
        }
      }

      const service = new Service();
      expect(await service.run(7)).toBe(result);
      expect(receiver).toBe(service);
      expect(receivedArgs).toEqual([7]);
      expect(methodCalls).toBe(1);
      expect(received).toEqual(mode === 'omitted'
        ? [[nativeOptions, undefined]]
        : [[nativeOptions, { requireAfterCommit: false }]]);
    },
  );

  it('runs a copy-A healthy owner through the copy-B decorator only after the commit barrier', async () => {
    const copyA = await import(`${new URL('./service.ts', import.meta.url).href}?copy-a-owner`);
    const copyB = await import(`${new URL('./transaction.ts', import.meta.url).href}?copy-b-decorator`);
    const commitEntered = barrier();
    const commitRelease = barrier();
    const events: string[] = [];
    const owner = new copyA.PrismaService({
      async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
        const value = await callback({});
        commitEntered.release();
        await commitRelease.promise;
        events.push('commit');
        return value;
      },
    });
    class Service {
      readonly owner = owner;

      @copyB.Transaction((self: Service) => self.owner, undefined, { requireAfterCommit: true })
      async save() {
        this.owner.afterCommit(() => { events.push('hook'); });
        return 'saved';
      }
    }

    const run = new Service().save();
    let settled = false;
    const observed = run.finally(() => { settled = true; });
    try {
      await commitEntered.promise;
      expect(events).toEqual([]);
      expect(settled).toBe(false);
      commitRelease.release();
      await expect(observed).resolves.toBe('saved');
      expect(events).toEqual(['commit', 'hook']);
    } finally {
      commitRelease.release();
      await Promise.allSettled([observed]);
    }
  });
});
