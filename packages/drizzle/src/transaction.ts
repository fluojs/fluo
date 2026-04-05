import { Inject } from '@konekti/core';
import type { Interceptor, InterceptorContext } from '@konekti/http';

import { DrizzleDatabase } from './database.js';
import type { DrizzleDatabaseLike } from './types.js';

/**
 * HTTP interceptor that wraps each request in a Drizzle request transaction boundary.
 */
@Inject([DrizzleDatabase])
export class DrizzleTransactionInterceptor implements Interceptor {
  constructor(private readonly database: DrizzleDatabase<DrizzleDatabaseLike<unknown, unknown>, unknown, unknown>) {}

  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.database.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
