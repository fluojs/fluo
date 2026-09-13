import type { DrizzleDatabase, DrizzleDatabaseFacade } from './database.js';
import type { DrizzleDatabaseLike } from './types.js';

/**
 * Builds the module-owned facade that forwards direct Drizzle calls to `current()`.
 *
 * @internal
 * @param database Lifecycle-aware wrapper owned by the Drizzle module registration.
 * @returns The facade used by the module's injected Drizzle handle.
 */
export function createDrizzleDatabaseFacade<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(
  database: DrizzleDatabase<TDatabase, TTransactionDatabase, TTransactionOptions>,
): DrizzleDatabaseFacade<TDatabase, TTransactionDatabase, TTransactionOptions> {
  return new Proxy(database, {
    get(target, property) {
      if (property in target) {
        const value = Reflect.get(target, property, target);

        return typeof value === 'function' ? value.bind(target) : value;
      }

      const currentDatabase = target.current() as Record<PropertyKey, unknown>;
      const value = Reflect.get(currentDatabase, property, currentDatabase);

      return typeof value === 'function' ? value.bind(currentDatabase) : value;
    },
  }) as DrizzleDatabaseFacade<TDatabase, TTransactionDatabase, TTransactionOptions>;
}
