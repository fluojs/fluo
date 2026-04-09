import { Inject } from '@konekti/core';
import type { Interceptor, InterceptorContext } from '@konekti/http';

import { PrismaService } from './service.js';
import type { PrismaClientLike } from './types.js';

/**
 * HTTP interceptor that wraps a request handler in `PrismaService.requestTransaction(...)`.
 *
 * @remarks
 * Pair this with repository/service code that reads `PrismaService.current()` so downstream calls share the same
 * request-scoped transaction client.
 */
@Inject([PrismaService])
export class PrismaTransactionInterceptor implements Interceptor {
  constructor(private readonly prisma: PrismaService<PrismaClientLike>) {}

  /**
   * Runs the downstream handler inside a Prisma request transaction boundary.
   *
   * @param context Interceptor context that supplies the request abort signal.
   * @param next Downstream handler chain.
   * @returns The downstream handler result after the request transaction settles.
   */
  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.prisma.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
