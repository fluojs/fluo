import type { CallHandler, Interceptor, InterceptorContext } from '@konekti/http';

import { serialize } from './serialize.js';

export class SerializerInterceptor implements Interceptor {
  async intercept(_context: InterceptorContext, next: CallHandler): Promise<unknown> {
    const value = await next.handle();
    return serialize(value);
  }
}
