import type { Token } from '@fluojs/core';

import type {
  CallHandler,
  Interceptor,
  InterceptorContext,
  InterceptorLike,
  RequestContext,
} from './types.js';

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

/**
 * Run interceptor chain.
 *
 * @param definitions The definitions.
 * @param context The context.
 * @param terminal The terminal.
 * @returns The run interceptor chain result.
 */
export async function runInterceptorChain(
  definitions: InterceptorLike[],
  context: InterceptorContext,
  terminal: () => Promise<unknown>,
): Promise<unknown> {
  if (definitions.length === 0) {
    return terminal();
  }

  let next: CallHandler = {
    handle: terminal,
  };

  for (let index = definitions.length - 1; index >= 0; index -= 1) {
    const definition = definitions[index];
    const interceptor = await resolveInterceptor(definition, context.requestContext);
    const previous = next;

    next = {
      handle: () => Promise.resolve(interceptor.intercept(context, previous)),
    };
  }

  return next.handle();
}
