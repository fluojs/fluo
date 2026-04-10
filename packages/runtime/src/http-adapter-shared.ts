import {
  createCorsMiddleware,
  createErrorResponse,
  createSecurityHeadersMiddleware,
  matchRoutePattern,
  normalizeRoutePattern,
  NotFoundException,
  type CorsOptions,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type MiddlewareContext,
  type MiddlewareLike,
  type Next,
  type SecurityHeadersOptions,
} from '@fluojs/http';

import { bootstrapApplication } from './bootstrap.js';
import { createConsoleApplicationLogger } from './logging/logger.js';
import type { Application, ApplicationLogger, CreateApplicationOptions, ModuleType } from './types.js';

export type HttpAdapterCorsInput = false | string | string[] | CorsOptions;

export interface HttpAdapterListenTarget {
  bindTarget: string;
  url: string;
}

export interface HttpAdapterMiddlewareOptions {
  cors?: HttpAdapterCorsInput;
  globalPrefix?: string;
  globalPrefixExclude?: readonly string[];
  middleware?: MiddlewareLike[];
  securityHeaders?: false | SecurityHeadersOptions;
}

export interface BootstrapHttpAdapterApplicationOptions
  extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'>,
    HttpAdapterMiddlewareOptions {
  logger?: ApplicationLogger;
}

export interface RunHttpAdapterApplicationOptions extends BootstrapHttpAdapterApplicationOptions {
  forceExitTimeoutMs?: number;
  shutdownRegistration?: HttpAdapterShutdownRegistration;
}

export type HttpAdapterShutdownRegistration = (
  app: Application,
  logger: ApplicationLogger,
  forceExitTimeoutMs?: number,
) => void | (() => void);

type ManagedHttpApplicationAdapter = HttpApplicationAdapter & {
  getListenTarget(): HttpAdapterListenTarget;
};

export async function bootstrapHttpAdapterApplication(
  rootModule: ModuleType,
  options: BootstrapHttpAdapterApplicationOptions,
  adapter: HttpApplicationAdapter,
): Promise<Application> {
  return bootstrapApplication({
    ...options,
    adapter,
    logger: options.logger ?? createConsoleApplicationLogger(),
    middleware: createHttpAdapterMiddleware(options),
    rootModule,
  });
}

export function createHttpAdapterMiddleware(options: HttpAdapterMiddlewareOptions): MiddlewareLike[] {
  const middleware = [...(options.middleware ?? [])];

  if (options.securityHeaders !== false) {
    middleware.unshift(createSecurityHeadersMiddleware(
      typeof options.securityHeaders === 'object' ? options.securityHeaders : undefined,
    ));
  }

  if (options.globalPrefix) {
    middleware.unshift(createGlobalPrefixMiddleware(options.globalPrefix, options.globalPrefixExclude));
  }

  if (options.cors !== undefined && options.cors !== false) {
    middleware.unshift(createCorsMiddleware(resolveCorsOptions(options.cors)));
  }

  return middleware;
}

export function formatHttpAdapterListenMessage(target: HttpAdapterListenTarget): string {
  return target.url.endsWith(target.bindTarget)
    ? `Listening on ${target.url}`
    : `Listening on ${target.url} (bound to ${target.bindTarget})`;
}

export async function runHttpAdapterApplication(
  rootModule: ModuleType,
  options: RunHttpAdapterApplicationOptions,
  adapter: ManagedHttpApplicationAdapter,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  const app = await bootstrapApplication({
    ...options,
    adapter,
    logger,
    middleware: createHttpAdapterMiddleware(options),
    rootModule,
  });

  try {
    await app.listen();
    logger.log(formatHttpAdapterListenMessage(adapter.getListenTarget()), 'KonektiFactory');
  } catch (error: unknown) {
    logger.error('Failed to start application.', error, 'KonektiFactory');

    if (app.state !== 'closed') {
      try {
        await app.close('bootstrap-failed');
      } catch (closeError) {
        logger.error('Failed to close application after startup failure.', closeError, 'KonektiFactory');
      }
    }

    throw error;
  }

  const unregisterShutdownSignals = options.shutdownRegistration?.(
    app,
    logger,
    options.forceExitTimeoutMs,
  ) ?? (() => {});
  const close = app.close.bind(app);
  let shutdownSignalsUnregistered = false;

  app.close = async (signal?: string) => {
    if (!shutdownSignalsUnregistered) {
      unregisterShutdownSignals();
      shutdownSignalsUnregistered = true;
    }

    await close(signal);
  };

  return app;
}

function createGlobalPrefixMiddleware(prefix: string, exclude: readonly string[] | undefined): MiddlewareLike {
  const normalizedPrefix = normalizeRoutePattern(prefix);

  if (normalizedPrefix === '/') {
    return {
      async handle(_context: MiddlewareContext, next: Next) {
        await next();
      },
    };
  }

  const exclusions = [...(exclude ?? [])].map((path) => normalizeRoutePattern(path));

  return {
    async handle(context: MiddlewareContext, next: Next) {
      const requestPath = normalizeRoutePattern(context.request.path);

      if (matchesExcludedPath(requestPath, exclusions)) {
        await next();
        return;
      }

      if (shouldRejectGlobalPrefixRequest(requestPath, normalizedPrefix, exclusions)) {
        await writeGlobalPrefixNotFound(context.requestContext.requestId, context.response);
        return;
      }

      const strippedPath = stripGlobalPrefix(requestPath, normalizedPrefix);
      context.request = rewriteGlobalPrefixRequest(context.request, requestPath, strippedPath);
      await next();
    },
  };
}

function shouldRejectGlobalPrefixRequest(
  requestPath: string,
  normalizedPrefix: string,
  exclusions: readonly string[],
): boolean {
  if (!matchesPrefix(requestPath, normalizedPrefix)) {
    return true;
  }

  return matchesExcludedPath(stripGlobalPrefix(requestPath, normalizedPrefix), exclusions);
}

function rewriteGlobalPrefixRequest(
  request: MiddlewareContext['request'],
  requestPath: string,
  strippedPath: string,
): MiddlewareContext['request'] {
  return {
    ...request,
    path: strippedPath,
    url: rewritePrefixedUrl(request.url, requestPath, strippedPath),
  };
}

function writeGlobalPrefixNotFound(requestId: string | undefined, response: FrameworkResponse): Promise<void> {
  const error = new NotFoundException('Resource not found.');
  response.setStatus(error.status);
  return Promise.resolve(response.send(createErrorResponse(error, requestId)));
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function stripGlobalPrefix(path: string, prefix: string): string {
  if (path === prefix) {
    return '/';
  }

  return normalizeRoutePattern(path.slice(prefix.length));
}

function matchesExcludedPath(path: string, exclusions: readonly string[]): boolean {
  return exclusions.some((pattern) => matchRoutePattern(pattern, path));
}

function rewritePrefixedUrl(url: string, originalPath: string, rewrittenPath: string): string {
  if (!url.startsWith(originalPath)) {
    return rewrittenPath;
  }

  return rewrittenPath + url.slice(originalPath.length);
}

function resolveCorsOptions(cors: Exclude<HttpAdapterCorsInput, false>): CorsOptions {
  const defaults: CorsOptions = {
    allowHeaders: ['Authorization', 'Content-Type'],
    exposeHeaders: ['X-Request-Id'],
  };

  if (typeof cors === 'string' || Array.isArray(cors)) {
    return { ...defaults, allowOrigin: cors };
  }

  return { ...defaults, ...cors };
}
