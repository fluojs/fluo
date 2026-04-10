import { Inject } from '@fluojs/core';
import type { Interceptor, InterceptorContext } from '@fluojs/http';

import { MongooseConnection } from './connection.js';
import type { MongooseConnectionLike } from './types.js';

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
