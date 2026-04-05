import { Inject } from '@konekti/core';
import type { Interceptor, InterceptorContext } from '@konekti/http';

import { MongooseConnection } from './connection.js';
import type { MongooseConnectionLike } from './types.js';

/**
 * HTTP interceptor that wraps each request in a Mongoose request transaction boundary.
 */
@Inject([MongooseConnection])
export class MongooseTransactionInterceptor implements Interceptor {
  constructor(private readonly connection: MongooseConnection<MongooseConnectionLike>) {}

  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.connection.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
