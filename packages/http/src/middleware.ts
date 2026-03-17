import type { Constructor, Token } from '@konekti/core';

import type { Middleware, MiddlewareContext, MiddlewareLike, MiddlewareRouteConfig, Next, RequestContext } from './types.js';

function isMiddleware(value: MiddlewareLike): value is Middleware {
  return typeof value === 'object' && value !== null && 'handle' in value;
}

export function isMiddlewareRouteConfig(value: MiddlewareLike): value is MiddlewareRouteConfig {
  return typeof value === 'object' && value !== null && 'middleware' in value && 'routes' in value;
}

function matchRoute(pattern: string, path: string): boolean {
  const normPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const normPattern = pattern.endsWith('/') && pattern.length > 1 ? pattern.slice(0, -1) : pattern;

  if (normPattern.endsWith('/*')) {
    const prefix = normPattern.slice(0, -2);
    return normPath === prefix || normPath.startsWith(`${prefix}/`);
  }

  return normPath === normPattern;
}

export function forRoutes<T extends Constructor<Middleware>>(
  middlewareClass: T,
  ...routes: string[]
): MiddlewareRouteConfig {
  return { middleware: middlewareClass, routes };
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

    const definition = definitions[index];
    if (isMiddlewareRouteConfig(definition)) {
      const requestPath = context.request.path;
      const matches = definition.routes.length === 0 || definition.routes.some((route) => matchRoute(route, requestPath));
      if (!matches) {
        await dispatch(index + 1);
        return;
      }

      const middleware = await context.requestContext.container.resolve(definition.middleware);
      await middleware.handle(context, () => dispatch(index + 1));
      return;
    }

    const middleware = await resolveMiddleware(definition, context.requestContext);
    await middleware.handle(context, () => dispatch(index + 1));
  };

  await dispatch(0);
}
