import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as publicApi from './index.js';
import {
  MongooseConnection,
  Transaction,
  TransactionRollbackCapabilityError,
  TransactionRollbackOnlyError,
} from './index.js';
import type { MongooseHandleProvider, TransactionBoundaryOptions } from './index.js';

// Protocol double for these deterministic native-runner fixtures. Real driver
// confirmation is exercised by rollback-observer tests and the PostgreSQL/Mongo fixture.
const observerDouble = {
  run: <T>(callback: () => Promise<T>): Promise<T> => callback(),
  beginAttempt: () => ({ confirmRollback: () => true as const }),
};

interface Outcome {
  readonly accepted: boolean;
  readonly code: string;
}

const policy: TransactionBoundaryOptions<Outcome> = { shouldRollback: (value) => !value.accepted };

function fixture() {
  const events: string[] = [];
  const conn = new MongooseConnection({
    async startSession() {
      return {
        startTransaction() { events.push('start'); },
        commitTransaction() { events.push('commit'); },
        abortTransaction() { events.push('abort'); },
        endSession() { events.push('end'); },
      };
    },
  }, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
  return { conn, events };
}

describe('Mongoose Result rollback decorator and types', () => {
  it('accepts a query-isolated copy-A owner through the copy-B decorator capability contract', async () => {
    const copyA = await import(`${new URL('./connection.ts', import.meta.url).href}?copy-a-owner`);
    const copyB = await import(`${new URL('./transaction.ts', import.meta.url).href}?copy-b-decorator`);
    const events: string[] = [];
    const owner = new copyA.MongooseConnection({
      async startSession() {
        return {
          startTransaction() { events.push('start'); },
          commitTransaction() { events.push('commit'); },
          abortTransaction() { events.push('abort'); },
          endSession() { events.push('end'); },
        };
      },
    }, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    const boundary: TransactionBoundaryOptions<Outcome> = {
      requireAfterCommit: true,
      shouldRollback: (value) => !value.accepted,
    };
    const rejected: Outcome = { accepted: false, code: 'rejected' };
    const accepted: Outcome = { accepted: true, code: 'accepted' };
    class Service {
      readonly owner = owner;

      @copyB.Transaction((self: Service) => self.owner, boundary)
      async reject(): Promise<Outcome> {
        this.owner.afterCommit(() => { events.push('rejected-hook'); });
        return rejected;
      }

      @copyB.Transaction((self: Service) => self.owner, boundary)
      async accept(): Promise<Outcome> {
        this.owner.afterCommit(() => { events.push('accepted-hook'); });
        return accepted;
      }
    }

    expect(await new Service().reject()).toBe(rejected);
    expect(events).toEqual(['start', 'abort', 'end']);
    expect(await new Service().accept()).toBe(accepted);
    expect(events).toEqual(['start', 'abort', 'end', 'start', 'commit', 'end', 'accepted-hook']);
  });

  it.each(['unbranded', 'incomplete'] as const)(
    'rejects a query-isolated copy-B decorator %s owner lookalike before lifecycle work',
    async (kind) => {
      const copyB = await import(`${new URL('./transaction.ts', import.meta.url).href}?copy-b-negative`);
      let transactionCalls = 0;
      let methodCalls = 0;
      const target = {
        afterCommit() {},
        createPlatformStatusSnapshot() { return {}; },
        current() { return {}; },
        currentSession() { return undefined; },
        model() { return {}; },
        requestTransaction<T>(callback: () => Promise<T>) { return callback(); },
        transaction<T>(callback: () => Promise<T>) { transactionCalls += 1; return callback(); },
      };
      if (kind === 'incomplete') {
        Object.defineProperty(target, Symbol.for('@fluojs/mongoose/MongooseConnection.owner'), { value: 1 });
        Reflect.deleteProperty(target, 'currentSession');
      }
      class Service {
        @copyB.Transaction(() => target, {
          requireAfterCommit: true,
          shouldRollback: () => true,
        })
        async run() { methodCalls += 1; return false; }
      }

      await expect(new Service().run()).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
      expect({ transactionCalls, methodCalls }).toEqual({ transactionCalls: 0, methodCalls: 0 });
    },
  );

  it('preserves the accessor, this binding, typed arguments and original result', async () => {
    // Given
    const { conn, events } = fixture();
    const failure: Outcome = { accepted: false, code: 'rejected' };
    class Service {
      readonly selected = conn;

      @Transaction((self: Service) => self.selected, policy)
      async execute(code: string): Promise<Outcome> {
        expect(code).toBe(failure.code);
        this.selected.afterCommit(() => { events.push('hook'); });
        return failure;
      }
    }
    // When
    const result = new Service().execute('rejected');
    // Then
    expectTypeOf(result).toEqualTypeOf<Promise<Outcome>>();
    await expect(result).resolves.toBe(failure);
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it('supports the default accessor and explicit host/result generic arguments', async () => {
    // Given
    const { conn, events } = fixture();
    class Service {
      readonly conn = conn;

      @Transaction(undefined, { shouldRollback: (value: Outcome) => !value.accepted })
      async inferred(): Promise<Outcome> {
        return { accepted: false, code: 'inferred' };
      }

      @Transaction<Service, Outcome>(undefined, policy)
      async explicit(): Promise<Outcome> {
        return { accepted: false, code: 'explicit' };
      }
    }
    const service = new Service();
    // When
    const result = await conn.transaction(async () => {
      await service.inferred();
      return service.explicit();
    }, policy);
    // Then
    expect(result.code).toBe('explicit');
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it('keeps legacy no-argument, host-only, accessor and capability-only decorator calls typed', async () => {
    // Given
    const { conn, events } = fixture();
    class Service {
      readonly conn = conn;

      @Transaction()
      async plain() { return 1; }

      @Transaction<Service>()
      async hostOnly() { return 'two'; }

      @Transaction((self: Service) => self.conn)
      async accessor() { return true; }

      @Transaction(undefined, { requireAfterCommit: true })
      async capability() { return 4; }
    }
    const service = new Service();
    // When
    const values = await conn.transaction(async () => [
      await service.plain(), await service.hostOnly(), await service.accessor(), await service.capability(),
    ]);
    // Then
    expectTypeOf(service.plain).returns.toEqualTypeOf<Promise<number>>();
    expectTypeOf(service.hostOnly).returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf(service.accessor).returns.toEqualTypeOf<Promise<boolean>>();
    expect(values).toEqual([1, 'two', true, 4]);
    expect(events).toEqual(['start', 'commit', 'end']);
  });

  it('rejects raw or legacy targets before invoking their runner or decorated method', async () => {
    // Given: an afterCommit-shaped method alone does not establish Result rollback ownership.
    const invoked = vi.fn();
    const legacy = {
      afterCommit() {},
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        invoked();
        return fn();
      },
    };
    const callback = vi.fn(async () => ({ accepted: false, code: 'failure' }));
    class Service {
      @Transaction(() => legacy, policy)
      async execute() { return callback(); }
    }
    // When
    const result = new Service().execute();
    // Then
    await expect(result).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    expect(invoked).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('keeps provider predicates generic and exports only the public rollback errors', async () => {
    // Given
    const { conn } = fixture();
    const provider: MongooseHandleProvider = conn;
    const failure: Outcome = { accepted: false, code: 'failure' };
    // When
    const transaction = provider.transaction(async () => failure, policy);
    const request = provider.requestTransaction(async () => failure, undefined, policy);
    // Then
    expectTypeOf(transaction).toEqualTypeOf<Promise<Outcome>>();
    expectTypeOf(request).toEqualTypeOf<Promise<Outcome>>();
    expectTypeOf<TransactionBoundaryOptions<Outcome>['shouldRollback']>()
      .toEqualTypeOf<((value: Outcome) => boolean) | undefined>();
    expectTypeOf<TransactionBoundaryOptions['shouldRollback']>()
      .toEqualTypeOf<((value: unknown) => boolean) | undefined>();
    expectTypeOf<TransactionRollbackOnlyError['result']>().toEqualTypeOf<unknown>();
    await expect(transaction).resolves.toBe(failure);
    await expect(request).resolves.toBe(failure);
    expect(publicApi.TransactionRollbackCapabilityError).toBe(TransactionRollbackCapabilityError);
    expect(publicApi.TransactionRollbackOnlyError).toBe(TransactionRollbackOnlyError);
    expect(publicApi).not.toHaveProperty('ResultBoundary');
    expect(publicApi).not.toHaveProperty('evaluateResult');
  });
});
