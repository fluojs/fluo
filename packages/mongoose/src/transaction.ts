type TransactionConnection = {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
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
 * This is a TC39 standard method decorator. By default it uses `this.conn` when present, the decorated instance
 * itself when it is transaction-capable, or one unique nested `this.*.conn` collaborator. Pass an accessor when the
 * connection lives under a different field or more than one nested collaborator exposes a connection; the decorator
 * does not bind arbitrary transaction-capable properties to avoid selecting the wrong persistence handle.
 * Nested decorated calls reuse the ambient Mongoose session through `MongooseConnection.transaction(...)`.
 *
 * @param accessor Optional connection resolver for the decorated service instance.
 * @returns A standard method decorator that executes the original method inside a Mongoose transaction.
 */
export function Transaction<THost>(
  accessor?: (self: THost) => TransactionConnection,
): <TArgs extends unknown[], TResult>(
  value: TransactionMethod<THost, TArgs, TResult>,
  context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
) => TransactionMethod<THost, TArgs, TResult> {
  return function transactionDecorator<TArgs extends unknown[], TResult>(
    value: TransactionMethod<THost, TArgs, TResult>,
    _context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
  ) {
    return async function transactionWrappedMethod(this: THost, ...args: TArgs): Promise<TResult> {
      const connection = resolveTransactionConnection(this, accessor);

      return connection.transaction(() => value.apply(this, args));
    };
  };
}
