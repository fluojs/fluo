import type { AsyncLocalStorage } from 'node:async_hooks';
import {
  TransactionRollbackCapabilityError,
  type TransactionRollbackObserver,
  TransactionRollbackUnconfirmedError,
} from './result-rollback.js';

type Attempt = {
  claimed: boolean;
  rollbackSql: boolean;
  cleanup: boolean;
  errors: unknown[];
};

function wrapMethod<T extends object>(target: T, method: string, wrap: (invoke: (...args: unknown[]) => unknown, args: unknown[]) => unknown): T {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key, object);
      if (typeof value !== 'function') return value;
      if (key !== method) return value.bind(object);
      return (...args: unknown[]) => wrap((...input) => Reflect.apply(value, object, input), args);
    },
  });
}

function object(value: unknown): object {
  if (typeof value !== 'object' || value === null) throw new TransactionRollbackCapabilityError();
  return value;
}

/**
 * Observes public Prisma adapter-pg SQL rollback and adapter cleanup without patching a client or engine.
 *
 * @remarks Construct the Prisma client with the returned `adapter`, and register the paired
 * `rollbackObserver` in Fluo module/service options. A preconstructed client cannot be retrofitted.
 * This capability targets Prisma 7 adapter-pg interactive transactions, not other engines or adapters.
 * @param factory Public `PrismaPg` adapter factory used to construct the client.
 * @returns The type-preserving factory proxy and its paired observation capability.
 */
export function createPrismaRollbackObserver<TFactory extends object>(factory: TFactory): {
  adapter: TFactory;
  rollbackObserver: TransactionRollbackObserver;
} {
  const Constructor = globalThis.process?.getBuiltinModule?.('node:async_hooks').AsyncLocalStorage;
  if (!Constructor || Reflect.get(factory, 'adapterName') !== '@prisma/adapter-pg'
    || typeof Reflect.get(factory, 'connect') !== 'function') {
    throw new TransactionRollbackCapabilityError();
  }
  const scopes: AsyncLocalStorage<Attempt[]> = new Constructor();
  const rollbackObserver: TransactionRollbackObserver = {
    run: (callback) => scopes.run([], callback),
    beginAttempt() {
      const pending = scopes.getStore()?.filter((attempt) => !attempt.claimed);
      if (!pending || pending.length !== 1) throw new TransactionRollbackCapabilityError();
      const attempt = pending[0];
      if (!attempt) throw new TransactionRollbackCapabilityError();
      attempt.claimed = true;
      return {
        confirmRollback() {
          if (attempt.errors.length === 1) throw attempt.errors[0];
          if (attempt.errors.length > 1) throw new AggregateError(attempt.errors, 'Native rollback and cleanup failed.');
          if (!attempt.rollbackSql || !attempt.cleanup) throw new TransactionRollbackUnconfirmedError();
          return true;
        },
      };
    },
  };
  const adapter = wrapMethod(factory, 'connect', async (connect, args) => {
    const connected = object(await connect(...args));
    return wrapMethod(connected, 'startTransaction', async (startTransaction, input) => {
      const transaction = object(await startTransaction(...input));
      const scope = scopes.getStore();
      // Ordinary native transactions outside Fluo remain untouched.
      if (!scope) return transaction;
      const options: unknown = Reflect.get(transaction, 'options');
      if (typeof options !== 'object' || options === null || Reflect.get(options, 'usePhantomQuery') !== false
        || typeof Reflect.get(transaction, 'executeRaw') !== 'function'
        || typeof Reflect.get(transaction, 'rollback') !== 'function') {
        throw new TransactionRollbackCapabilityError();
      }
      const attempt: Attempt = { claimed: false, rollbackSql: false, cleanup: false, errors: [] };
      scope.push(attempt);
      const queryObserved = wrapMethod(transaction, 'executeRaw', async (executeRaw, queryArgs) => {
        const query = queryArgs[0];
        const isRollback = typeof query === 'object' && query !== null
          && /^\s*ROLLBACK\s*;?\s*$/i.test(String(Reflect.get(query, 'sql')));
        try {
          const result = await executeRaw(...queryArgs);
          if (isRollback) attempt.rollbackSql = true;
          return result;
        } catch (error) {
          if (isRollback) attempt.errors.push(error);
          throw error;
        }
      });
      return wrapMethod(queryObserved, 'rollback', async (rollback, rollbackArgs) => {
        try {
          const result = await rollback(...rollbackArgs);
          attempt.cleanup = true;
          return result;
        } catch (error) {
          attempt.errors.push(error);
          throw error;
        }
      });
    });
  });
  return { adapter, rollbackObserver };
}
