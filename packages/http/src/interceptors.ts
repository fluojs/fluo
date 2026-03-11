import type { Token } from '@konekti/core';

import type {
  CallHandler,
  Interceptor,
  InterceptorContext,
  InterceptorLike,
  RequestContext,
} from './types';

function isInterceptor(value: InterceptorLike): value is Interceptor {
  return typeof value === 'object' && value !== null && 'intercept' in value;
}

async function resolveInterceptor(
  definition: InterceptorLike,
  requestContext: RequestContext,
): Promise<Interceptor> {
  if (isInterceptor(definition)) {
    return definition;
  }

  return requestContext.container.resolve(definition as Token<Interceptor>);
}

export async function runInterceptorChain(
  definitions: InterceptorLike[],
  context: InterceptorContext,
  terminal: () => Promise<unknown>,
): Promise<unknown> {
  let next: CallHandler = {
    handle: terminal,
  };

  for (const definition of [...definitions].reverse()) {
    const interceptor = await resolveInterceptor(definition, context.requestContext);
    const previous = next;

    next = {
      handle: () => Promise.resolve(interceptor.intercept(context, previous)),
    };
  }

  return next.handle();
}
