import type { CallHandler, Interceptor, InterceptorContext } from '@fluojs/http';

import { serialize } from './serialize.js';

/**
 * HTTP interceptor that serializes handler results before response writing.
 *
 * @remarks
 * Use this at the controller or route level when handlers return class instances
 * and you want `@Expose()`, `@Exclude()`, and `@Transform()` metadata applied
 * automatically. If the handler already committed `RequestContext.response`,
 * the interceptor returns the handler-owned value unchanged so streaming and
 * manually written responses keep their response ownership.
 */
export class SerializerInterceptor implements Interceptor {
  async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
    const value = await next.handle();

    if (context.requestContext.response.committed) {
      return value;
    }

    return serialize(value);
  }
}
