import { Inject } from '@konekti/core';
import type { Interceptor, InterceptorContext } from '@konekti/http';

import { DrizzleDatabase } from './database.js';
import type { DrizzleDatabaseLike } from './types.js';

/**
 * HTTP interceptor that wraps each request in a Drizzle request transaction boundary.
 *
 * @remarks
 * Pair this with repository/service code that reads `DrizzleDatabase.current()` so downstream calls share the same
 * request-scoped transaction handle.
 */
@Inject(DrizzleDatabase)
export class DrizzleTransactionInterceptor implements Interceptor {
  constructor(private readonly database: DrizzleDatabase<DrizzleDatabaseLike<unknown, unknown>, unknown, unknown>) {}

  /**
   * Runs the downstream handler inside a Drizzle request transaction boundary.
   *
   * @param context Interceptor context that supplies the request abort signal.
   * @param next Downstream handler chain.
   * @returns The downstream handler result after the request transaction settles.
   */
  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.database.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
