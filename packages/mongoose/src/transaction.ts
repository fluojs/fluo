type TransactionConnection = {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};

type TransactionMethod<THost, TArgs extends unknown[], TResult> = (
  this: THost,
  ...args: TArgs
) => Promise<TResult>;

function resolveTransactionConnection<THost>(self: THost, accessor?: (self: THost) => TransactionConnection): TransactionConnection {
  if (accessor) {
    return accessor(self);
  }

  const fallbackHost = self as THost & { conn?: TransactionConnection };
  if (fallbackHost.conn) {
    return fallbackHost.conn;
  }

  if (typeof (self as TransactionConnection).transaction === 'function') {
    return self as TransactionConnection;
  }

  if ((typeof self === 'object' && self !== null) || typeof self === 'function') {
    for (const value of Object.values(self as Record<string, unknown>)) {
      if (value && typeof (value as TransactionConnection).transaction === 'function') {
        return value as TransactionConnection;
      }

      const nestedConn = (value as { conn?: TransactionConnection } | null | undefined)?.conn;
      if (nestedConn && typeof nestedConn.transaction === 'function') {
        return nestedConn;
      }
    }
  }

  return self as TransactionConnection;
}

/**
 * Wraps a service method in a `MongooseConnection.transaction(...)` boundary.
 *
 * @remarks
 * This is a TC39 standard method decorator. By default it uses `this.conn` when present, or the decorated instance
 * itself as the transaction-capable connection. Pass an accessor when the connection lives under a different field.
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
