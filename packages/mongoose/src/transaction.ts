import { AfterCommitCapabilityError } from './after-commit.js';
import { MongooseConnection } from './connection.js';
import { TransactionRollbackCapabilityError } from './result-rollback.js';
import type { MongooseConnectionLike, TransactionBoundaryOptions } from './types.js';

type TransactionConnection = {
  transaction<T>(fn: () => Promise<T>, boundary?: TransactionBoundaryOptions<T>): Promise<T>;
};

type TransactionMethod<THost, TArgs extends unknown[], TResult> = (
  this: THost,
  ...args: TArgs
) => Promise<TResult>;

function isTransactionConnection(value: unknown): value is TransactionConnection {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { transaction?: unknown }).transaction === 'function'
  );
}

function collectNestedConnCandidates(self: unknown): TransactionConnection[] {
  if ((typeof self !== 'object' || self === null) && typeof self !== 'function') {
    return [];
  }

  const candidates = new Set<TransactionConnection>();

  for (const value of Object.values(self as Record<string, unknown>)) {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
      continue;
    }

    const nestedConn = (value as { conn?: unknown }).conn;
    if (isTransactionConnection(nestedConn)) {
      candidates.add(nestedConn);
    }
  }

  return Array.from(candidates);
}

function resolveTransactionConnection<THost>(self: THost, accessor?: (self: THost) => TransactionConnection): TransactionConnection {
  if (accessor) {
    const connection = accessor(self);
    if (isTransactionConnection(connection)) {
      return connection;
    }

    throw new Error('Mongoose @Transaction() accessor did not return a transaction-capable connection.');
  }

  const fallbackHost = self as THost & { conn?: TransactionConnection };
  if (isTransactionConnection(fallbackHost.conn)) {
    return fallbackHost.conn;
  }

  if (isTransactionConnection(self)) {
    return self;
  }

  const nestedConnCandidates = collectNestedConnCandidates(self);
  if (nestedConnCandidates.length === 1) {
    return nestedConnCandidates[0];
  }

  if (nestedConnCandidates.length > 1) {
    throw new Error('Mongoose @Transaction() found multiple nested this.*.conn candidates; pass an accessor.');
  }

  throw new Error('Mongoose @Transaction() could not resolve a transaction-capable connection from this.conn.');
}

/**
 * Wraps a service method in a `MongooseConnection.transaction(...)` boundary.
 *
 * @remarks
 * This is a TC39 standard method decorator. The canonical form passes an explicit connection accessor.
 * No-argument discovery of `this.conn`, the decorated instance, or one unique nested `this.*.conn` collaborator
 * remains only for legacy single-target compatibility. Migrate before adding another connection or ORM.
 * Nested decorated calls reuse the ambient Mongoose session through `MongooseConnection.transaction(...)`.
 *
 * @param accessor Explicit connection resolver, omitted only for legacy single-target compatibility.
 * @param boundary Optional package-owned capability requirements forwarded to the transaction boundary.
 * @returns A standard method decorator that executes the original method inside a Mongoose transaction.
 * @throws {AfterCommitCapabilityError} When opted-in after-commit support is absent from the selected target.
 * @throws {TransactionRollbackCapabilityError} When an opted-in Result policy selects a non-Fluo target.
 */
export function Transaction<THost, TBoundaryResult = unknown>(
  accessor?: (self: THost) => TransactionConnection,
  boundary?: TransactionBoundaryOptions<TBoundaryResult>,
): <TArgs extends unknown[], TResult extends TBoundaryResult>(
  value: TransactionMethod<THost, TArgs, TResult>,
  context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
) => TransactionMethod<THost, TArgs, TResult> {
  return function transactionDecorator<TArgs extends unknown[], TResult extends TBoundaryResult>(
    value: TransactionMethod<THost, TArgs, TResult>,
    _context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
  ) {
    return async function transactionWrappedMethod(this: THost, ...args: TArgs): Promise<TResult> {
      const connection = resolveTransactionConnection(this, accessor);
      if (boundary?.shouldRollback && !(connection instanceof MongooseConnection)) {
        throw new TransactionRollbackCapabilityError();
      }
      if (boundary?.requireAfterCommit && (
        !('afterCommit' in connection) || typeof connection.afterCommit !== 'function'
      )) {
        throw new AfterCommitCapabilityError('Mongoose @Transaction() requires a target with afterCommit support.');
      }

      return connection.transaction(() => value.apply(this, args), boundary);
    };
  };
}
