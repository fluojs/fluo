import type { Constructor, Token } from '@fluojs/core';

import type { Middleware, MiddlewareContext, MiddlewareLike, MiddlewareRouteConfig, Next, RequestContext } from '../types.js';

function isMiddleware(value: MiddlewareLike): value is Middleware {
  return typeof value === 'object' && value !== null && 'handle' in value;
}

export function isMiddlewareRouteConfig(value: MiddlewareLike): value is MiddlewareRouteConfig {
  return typeof value === 'object' && value !== null && 'middleware' in value && 'routes' in value;
}

export function normalizeRoutePattern(path: string): string {
  if (path.endsWith('/*')) {
    return `${normalizeRoutePattern(path.slice(0, -2))}/*`;
  }

  const segments = path.split('/').filter(Boolean);
  const normalized = `/${segments.join('/')}`;

  return normalized === '' ? '/' : normalized;
}

export function matchRoutePattern(pattern: string, path: string): boolean {
  const normalizedPath = normalizeRoutePattern(path);
  const normalizedPattern = normalizeRoutePattern(pattern);

  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return normalizedPath === normalizedPattern;
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

async function resolveActiveMiddlewareDefinitions(
  definitions: MiddlewareLike[],
  context: MiddlewareContext,
): Promise<Middleware[]> {
  const requestPath = context.request.path;
  const middlewareChain: Middleware[] = [];

  for (const definition of definitions) {
    if (isMiddlewareRouteConfig(definition)) {
      const matches = definition.routes.length === 0 || definition.routes.some((route) => matchRoutePattern(route, requestPath));

      if (!matches) {
        continue;
      }

      const middleware = await context.requestContext.container.resolve(definition.middleware);
      middlewareChain.push(middleware);
      continue;
    }

    middlewareChain.push(await resolveMiddleware(definition, context.requestContext));
  }

  return middlewareChain;
}

function deferNext(next: Next): Next {
  return async () => {
    await Promise.resolve();
    await next();
  };
}

export async function runMiddlewareChain(
  definitions: MiddlewareLike[],
  context: MiddlewareContext,
  terminal: Next,
): Promise<void> {
  const middlewareChain = await resolveActiveMiddlewareDefinitions(definitions, context);
  const composed = middlewareChain.reduceRight<Next>(
    (next, middleware) => deferNext(async () => {
      await middleware.handle(context, next);
    }),
    deferNext(terminal),
  );

  await composed();
}
