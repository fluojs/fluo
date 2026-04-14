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

/**
 * Input type for configuring CORS in an HTTP adapter.
 */
export type HttpAdapterCorsInput = false | string | string[] | CorsOptions;

/**
 * Resolved target for an HTTP server listener.
 */
export interface HttpAdapterListenTarget {
  /** The local address or host the server is bound to. */
  bindTarget: string;
  /** The public URL of the running server. */
  url: string;
}

/**
 * Common middleware options for HTTP adapters.
 */
export interface HttpAdapterMiddlewareOptions {
  /** CORS configuration for the adapter. */
  cors?: HttpAdapterCorsInput;
  /** Global prefix applied to all routes. */
  globalPrefix?: string;
  /** List of route patterns to exclude from the global prefix. */
  globalPrefixExclude?: readonly string[];
  /** Custom middleware to inject into the adapter pipeline. */
  middleware?: MiddlewareLike[];
  /** Security header configuration. */
  securityHeaders?: false | SecurityHeadersOptions;
}

/**
 * Options for bootstrapping an HTTP adapter application.
 */
export interface BootstrapHttpAdapterApplicationOptions
  extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'>,
    HttpAdapterMiddlewareOptions {
  /** Optional custom application logger. */
  logger?: ApplicationLogger;
}

/**
 * Options for running an HTTP adapter application with shutdown management.
 */
export interface RunHttpAdapterApplicationOptions extends BootstrapHttpAdapterApplicationOptions {
  /** Timeout for marking shutdown as failed during signal-driven teardown in milliseconds. */
  forceExitTimeoutMs?: number;
  /** Custom shutdown registration logic. */
  shutdownRegistration?: HttpAdapterShutdownRegistration;
}

/**
 * Function type for registering custom application shutdown logic.
 */
export type HttpAdapterShutdownRegistration = (
  app: Application,
  logger: ApplicationLogger,
  forceExitTimeoutMs?: number,
) => void | (() => void);

type ManagedHttpApplicationAdapter = HttpApplicationAdapter & {
  getListenTarget(): HttpAdapterListenTarget;
};

/**
 * Bootstraps an HTTP application with the provided adapter and options.
 *
 * @param rootModule The root application module class.
 * @param options Bootstrap configuration for middleware and logging.
 * @param adapter The HTTP platform adapter to use.
 * @returns A promise that resolves to the initialized application instance.
 */
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

/**
 * Resolves the final middleware chain for an HTTP adapter based on options.
 *
 * @param options Middleware configuration including CORS and prefix settings.
 * @returns An array of middleware instances to be registered in the adapter.
 */
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

/**
 * Formats a log message indicating that the HTTP adapter is listening on a specific target.
 *
 * @param target - The listen target containing the URL and bind target.
 * @returns A formatted string message.
 */
export function formatHttpAdapterListenMessage(target: HttpAdapterListenTarget): string {
  return target.url.endsWith(target.bindTarget)
    ? `Listening on ${target.url}`
    : `Listening on ${target.url} (bound to ${target.bindTarget})`;
}

/**
 * Boots and runs an HTTP application using the provided adapter and options,
 * including setup for shutdown management and logging.
 *
 * @param rootModule - The root application module class.
 * @param options - Run configuration including shutdown and logging settings.
 * @param adapter - The managed HTTP platform adapter to use.
 * @returns A promise that resolves to the running application instance.
 */
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
    logger.log(formatHttpAdapterListenMessage(adapter.getListenTarget()), 'FluoFactory');
  } catch (error: unknown) {
    logger.error('Failed to start application.', error, 'FluoFactory');

    if (app.state !== 'closed') {
      try {
        await app.close('bootstrap-failed');
      } catch (closeError) {
        logger.error('Failed to close application after startup failure.', closeError, 'FluoFactory');
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
