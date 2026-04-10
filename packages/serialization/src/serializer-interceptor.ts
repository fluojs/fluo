import type { CallHandler, Interceptor, InterceptorContext } from '@fluojs/http';

import { serialize } from './serialize.js';

/**
 * HTTP interceptor that serializes handler results before response writing.
 *
 * @remarks
 * Use this at the controller or route level when handlers return class instances
 * and you want `@Expose()`, `@Exclude()`, and `@Transform()` metadata applied
 * automatically.
 */
export class SerializerInterceptor implements Interceptor {
  async intercept(_context: InterceptorContext, next: CallHandler): Promise<unknown> {
    const value = await next.handle();
    return serialize(value);
  }
}
