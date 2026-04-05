import { Inject } from '@konekti/core';
import type { Interceptor, InterceptorContext } from '@konekti/http';

import { PrismaService } from './service.js';
import type { PrismaClientLike } from './types.js';

@Inject([PrismaService])
export class PrismaTransactionInterceptor implements Interceptor {
  constructor(private readonly prisma: PrismaService<PrismaClientLike>) {}

  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.prisma.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
