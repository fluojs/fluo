import type { Token } from '@konekti/core';

import type { Middleware, MiddlewareContext, MiddlewareLike, Next, RequestContext } from './types';

function isMiddleware(value: MiddlewareLike): value is Middleware {
  return typeof value === 'object' && value !== null && 'handle' in value;
}

async function resolveMiddleware(definition: MiddlewareLike, requestContext: RequestContext): Promise<Middleware> {
  if (isMiddleware(definition)) {
    return definition;
  }

  return requestContext.container.resolve(definition as Token<Middleware>);
}

export async function runMiddlewareChain(
  definitions: MiddlewareLike[],
  context: MiddlewareContext,
  terminal: Next,
): Promise<void> {
  const dispatch = async (index: number): Promise<void> => {
    if (index === definitions.length) {
      await terminal();
      return;
    }

    const middleware = await resolveMiddleware(definitions[index], context.requestContext);
    await middleware.handle(context, () => dispatch(index + 1));
  };

  await dispatch(0);
}
