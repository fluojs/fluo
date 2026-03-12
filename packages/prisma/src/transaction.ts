import { Inject } from '@konekti/core';
import type { Interceptor, InterceptorContext } from '@konekti/http';

import { PrismaService } from './service';
import type { PrismaClientLike } from './types';

@Inject([PrismaService])
export class PrismaTransactionInterceptor implements Interceptor {
  constructor(private readonly prisma: PrismaService<PrismaClientLike<unknown>, unknown>) {}

  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.prisma.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
