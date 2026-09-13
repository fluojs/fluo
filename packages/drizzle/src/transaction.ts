import { AfterCommitCapabilityError, type TransactionBoundaryOptions } from './after-commit.js';
import { DrizzleDatabase } from './database.js';
import { TransactionRollbackCapabilityError } from './result-rollback.js';
import type { DrizzleDatabaseLike } from './types.js';

type TransactionCapableDrizzle<TTransactionOptions = unknown> = {
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions, boundary?: TransactionBoundaryOptions<T>): Promise<T>;
};

type TransactionAccessor<THost, TTransactionOptions> = (
  self: THost,
) => TransactionCapableDrizzle<TTransactionOptions>;

type TransactionMethod<THost, TArgs extends unknown[], TResult> = (
  this: THost,
  ...args: TArgs
) => Promise<TResult>;

function isTransactionCapableDrizzle<TTransactionOptions>(
  value: unknown,
): value is TransactionCapableDrizzle<TTransactionOptions> {
  return typeof (value as { transaction?: unknown } | null)?.transaction === 'function';
}
function findNestedTransactionTarget<TTransactionOptions>(value: unknown): TransactionCapableDrizzle<TTransactionOptions> | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }

  const directDatabase = (value as { db?: unknown }).db;
  if (isTransactionCapableDrizzle<TTransactionOptions>(directDatabase)) {
    return directDatabase;
  }

  for (const propertyValue of Object.values(value)) {
    if (isTransactionCapableDrizzle<TTransactionOptions>(propertyValue)) {
      return propertyValue;
    }
  }

  for (const propertyValue of Object.values(value)) {
    const nestedDatabase = (propertyValue as { db?: unknown } | null)?.db;
    if (isTransactionCapableDrizzle<TTransactionOptions>(nestedDatabase)) {
      return nestedDatabase;
    }
  }

  return undefined;
}

function resolveDefaultTransactionTarget<THost, TTransactionOptions>(
  self: THost,
): TransactionCapableDrizzle<TTransactionOptions> {
  const implicitTarget = findNestedTransactionTarget<TTransactionOptions>(self) ?? self;

  return implicitTarget as TransactionCapableDrizzle<TTransactionOptions>;
}

/**
 * Standard TC39 method decorator that runs a service method inside a Drizzle transaction boundary.
 *
 * @remarks
 * The canonical form is `@Transaction((self) => self.db, nativeOptions, boundary)`.
 * No-argument and options-only calls retain target discovery (`this.db`, direct properties, nested `.db`, then the
 * decorated instance) only for legacy single-target compatibility. Migrate to an accessor before adding another
 * database or ORM so property order cannot select the wrong owner.
 *
 * @param accessorOrOptions Explicit target accessor, or legacy compatibility Drizzle transaction options.
 * @param options Optional Drizzle transaction options when an accessor is supplied.
 * @param boundary Optional Fluo capability requirements checked before the method runs.
 * @returns A standard 2023-11 method decorator.
 */
export function Transaction<THost, TTransactionOptions = unknown, TResult = unknown>(
  accessorOrOptions?: TransactionAccessor<THost, TTransactionOptions> | TTransactionOptions,
  options?: TTransactionOptions,
  boundary?: TransactionBoundaryOptions<TResult>,
) {
  const accessor = typeof accessorOrOptions === 'function'
    ? accessorOrOptions as TransactionAccessor<THost, TTransactionOptions>
    : undefined;
  const transactionOptions = accessor ? options : accessorOrOptions as TTransactionOptions | undefined;

  return <TArgs extends unknown[], TMethodResult extends TResult>(
    value: TransactionMethod<THost, TArgs, TMethodResult>,
    context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TMethodResult>>,
  ): TransactionMethod<THost, TArgs, TMethodResult> => {
    if (context.kind !== 'method') {
      throw new Error('@Transaction() can only decorate methods.');
    }

    return async function transactionMethod(this: THost, ...args: TArgs): Promise<TMethodResult> {
      const drizzleDatabase = accessor ? accessor(this) : resolveDefaultTransactionTarget<THost, TTransactionOptions>(this);

      if (boundary?.shouldRollback && !(drizzleDatabase instanceof DrizzleDatabase)) {
        throw new TransactionRollbackCapabilityError();
      }

      if (boundary?.requireAfterCommit
        && (!('afterCommit' in drizzleDatabase) || typeof drizzleDatabase.afterCommit !== 'function')) {
        throw new AfterCommitCapabilityError();
      }

      return drizzleDatabase.transaction(
        () => value.apply(this, args),
        transactionOptions,
        boundary,
      );
    };
  };
}
