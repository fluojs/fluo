import { AsyncLocalStorage } from 'node:async_hooks';
import {
  TransactionRollbackCapabilityError,
  type TransactionRollbackObserver,
  TransactionRollbackUnconfirmedError,
} from './result-rollback.js';

type Attempt = { claimed: boolean; rolledBack: boolean; released: boolean; errors: unknown[] };

/**
 * Observes node-postgres ROLLBACK execution and checked-out client release through public methods.
 *
 * @remarks Construct Drizzle with the returned client/pool proxy and register the paired
 * `rollbackObserver` in Fluo options. Only promise-based node-postgres transactions are supported.
 * Other Drizzle drivers require their own positive native observation capability.
 * @param client Public node-postgres Pool or connected Client used to construct Drizzle.
 * @returns The type-preserving client proxy and paired rollback observer.
 */
export function createDrizzleRollbackObserver<TClient extends object>(client: TClient): {
  client: TClient;
  rollbackObserver: TransactionRollbackObserver;
} {
  if (typeof Reflect.get(client, 'query') !== 'function') throw new TransactionRollbackCapabilityError();
  const scopes = new AsyncLocalStorage<Attempt[]>();
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
          if (attempt.errors.length > 1) throw new AggregateError(attempt.errors, 'Native rollback and release failed.');
          if (!attempt.rolledBack || !attempt.released) throw new TransactionRollbackUnconfirmedError();
          return true;
        },
      };
    },
  };
  const wrap = <T extends object>(target: T, pooled: boolean): T => {
    let attempt: Attempt | undefined;
    let activeScope: Attempt[] | undefined;
    return new Proxy(target, {
      get(object, key) {
        const value: unknown = Reflect.get(object, key, object);
        if (typeof value !== 'function') return value;
        if (key === 'connect') {
          return (...args: unknown[]) => {
            const connected: unknown = Reflect.apply(value, object, args);
            if (!scopes.getStore() || !(connected instanceof Promise)) return connected;
            return connected.then((connection: unknown) => typeof connection === 'object' && connection !== null
              ? wrap(connection, true) : connection);
          };
        }
        if (key === 'release') {
          return (...args: unknown[]) => {
            try {
              const result: unknown = Reflect.apply(value, object, args);
              if (attempt) attempt.released = true;
              activeScope = undefined;
              return result;
            } catch (error) {
              attempt?.errors.push(error);
              throw error;
            }
          };
        }
        if (key === 'query') {
          return (...args: unknown[]) => {
            const scope = scopes.getStore();
            if (!scope) return Reflect.apply(value, object, args);
            const query = args[0];
            const text = typeof query === 'string' ? query : typeof query === 'object' && query !== null
              ? String(Reflect.get(query, 'text')) : '';
            if (/^\s*begin\b/i.test(text)) {
              if (activeScope && activeScope !== scope) throw new TransactionRollbackCapabilityError();
              activeScope = scope;
              attempt = { claimed: false, rolledBack: false, released: !pooled, errors: [] };
              scope.push(attempt);
            }
            const current = attempt;
            const rollback = /^\s*rollback\s*;?\s*$/i.test(text);
            try {
              const result: unknown = Reflect.apply(value, object, args);
              if (!(result instanceof Promise)) throw new TransactionRollbackCapabilityError();
              return result.then((outcome: unknown) => {
                if (rollback && current) current.rolledBack = true;
                if (!pooled && /^\s*(commit|rollback)\s*;?\s*$/i.test(text)) activeScope = undefined;
                return outcome;
              }, (error: unknown) => {
                if (rollback) current?.errors.push(error);
                throw error;
              });
            } catch (error) {
              if (rollback) current?.errors.push(error);
              throw error;
            }
          };
        }
        return value.bind(object);
      },
    });
  };
  return { client: wrap(client, false), rollbackObserver };
}
