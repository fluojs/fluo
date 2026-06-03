import { Inject } from '@fluojs/core';
import type { Interceptor, InterceptorContext } from '@fluojs/http';

import { MongooseConnection } from './connection.js';
import type { MongooseConnectionLike } from './types.js';

type TransactionConnection = {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};

type TransactionMethod<THost> = (this: THost, ...args: unknown[]) => Promise<unknown>;

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
): (value: TransactionMethod<THost>, context: ClassMethodDecoratorContext<THost, TransactionMethod<THost>>) => TransactionMethod<THost> {
  return (value, _context) => {
    return async function transactionWrappedMethod(this: THost, ...args: unknown[]) {
      const connection = resolveTransactionConnection(this, accessor);

      return connection.transaction(() => value.apply(this, args));
    };
  };
}

/**
 * HTTP interceptor that wraps each request in a Mongoose request transaction boundary.
 *
 * @remarks
 * Pair this with repository/service code that reads `MongooseConnection.current()` and `currentSession()` so downstream
 * calls share the same request-scoped session.
 */
@Inject(MongooseConnection)
export class MongooseTransactionInterceptor implements Interceptor {
  constructor(private readonly connection: MongooseConnection<MongooseConnectionLike>) {}

  /**
   * Runs the downstream handler inside a Mongoose request transaction boundary.
   *
   * @param context Interceptor context that supplies the request abort signal.
   * @param next Downstream handler chain.
   * @returns The downstream handler result after the request transaction settles.
   */
  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.connection.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
