import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import {
  createServer as createHttpsServer,
  type ServerOptions as HttpsServerOptions,
} from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { URL } from 'node:url';

import express, {
  type Express,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from 'express';

import {
  BadRequestException,
  createCorsMiddleware,
  createErrorResponse,
  createSecurityHeadersMiddleware,
  HttpException,
  InternalServerErrorException,
  matchRoutePattern,
  normalizeRoutePattern,
  NotFoundException,
  PayloadTooLargeException,
  type CorsOptions,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
  type HttpApplicationAdapter,
  type MiddlewareContext,
  type MiddlewareLike,
  type Next,
  type SecurityHeadersOptions,
} from '@konekti/http';
import {
  bootstrapApplication,
  createConsoleApplicationLogger,
  parseMultipart,
  type Application,
  type ApplicationLogger,
  type CreateApplicationOptions,
  type ModuleType,
  type MultipartOptions,
  type UploadedFile,
} from '@konekti/runtime';
import {
  dispatchWithRequestResponseFactory,
  type RequestResponseFactory,
} from '@konekti/runtime/internal';

declare module '@konekti/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

export interface ExpressAdapterOptions {
  host?: string;
  https?: HttpsServerOptions;
  maxBodySize?: number;
  port?: number;
  rawBody?: boolean;
  retryDelayMs?: number;
  retryLimit?: number;
  shutdownTimeoutMs?: number;
}

export type ExpressApplicationSignal = 'SIGINT' | 'SIGTERM';
export type CorsInput = false | string | string[] | CorsOptions;

const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BODY_SIZE = 1 * 1024 * 1024;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface BootstrapExpressApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  cors?: CorsInput;
  globalPrefix?: string;
  globalPrefixExclude?: readonly string[];
  host?: string;
  https?: HttpsServerOptions;
  logger?: ApplicationLogger;
  maxBodySize?: number;
  middleware?: MiddlewareLike[];
  multipart?: MultipartOptions;
  port?: number;
  rawBody?: boolean;
  retryDelayMs?: number;
  retryLimit?: number;
  securityHeaders?: false | SecurityHeadersOptions;
  shutdownTimeoutMs?: number;
}

export interface RunExpressApplicationOptions extends BootstrapExpressApplicationOptions {
  forceExitTimeoutMs?: number;
  shutdownSignals?: false | readonly ExpressApplicationSignal[];
}

interface ExpressListenTarget {
  bindTarget: string;
  url: string;
}

type ExpressServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

type ExpressFrameworkResponse = FrameworkResponse & {
  raw: ExpressResponse;
  statusSet?: boolean;
};

type ExpressMultipartLikeError = Error & {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
};

export class ExpressHttpApplicationAdapter implements HttpApplicationAdapter {
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private readonly app: Express;
  private readonly requestResponseFactory: RequestResponseFactory<
    ExpressRequest,
    ExpressResponse,
    ExpressFrameworkResponse
  >;
  private readonly server: ExpressServer;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly port: number,
    private readonly host: string | undefined,
    private readonly retryDelayMs = 150,
    private readonly retryLimit = 20,
    private readonly httpsOptions: HttpsServerOptions | undefined,
    private readonly multipartOptions?: MultipartOptions,
    private readonly maxBodySize = DEFAULT_MAX_BODY_SIZE,
    private readonly preserveRawBody = false,
    private readonly shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {
    this.app = express();
    this.requestResponseFactory = createExpressRequestResponseFactory(
      this.multipartOptions,
      this.maxBodySize,
      this.preserveRawBody,
    );
    this.server = createExpressServer(this.httpsOptions, this.app);
    this.app.use((request: ExpressRequest, response: ExpressResponse) => {
      void this.handleRequest(request, response);
    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  getServer(): unknown {
    return this.server;
  }

  getListenTarget(): ExpressListenTarget {
    return resolveListenTarget(this.server.address() ?? null, this.port, this.host, this.httpsOptions !== undefined);
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;
    await this.listenWithRetry();
  }

  async close(): Promise<void> {
    if (!this.server.listening) {
      this.dispatcher = undefined;
      return;
    }

    if (!this.closeInFlight) {
      const closePromise = closeServerWithDrain(this.server, this.sockets, this.shutdownTimeoutMs);
      const closeInFlight = closePromise.finally(() => {
        this.closeInFlight = undefined;
        this.dispatcher = undefined;
      });
      this.closeInFlight = closeInFlight;
      void closeInFlight.catch(() => {});
    }

    const closeInFlight = this.closeInFlight;

    if (!closeInFlight) {
      return;
    }

    await waitForCloseWithTimeout(closeInFlight, this.shutdownTimeoutMs);
  }

  private async listenWithRetry(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await listenServer(this.server, this.port, this.host);
        return;
      } catch (error: unknown) {
        if (!isAddressInUseError(error) || attempt >= this.retryLimit) {
          throw error;
        }

        await closeServerSilently(this.server);
        await delay(this.retryDelayMs);
      }
    }
  }

  private async handleRequest(request: ExpressRequest, response: ExpressResponse): Promise<void> {
    await dispatchWithRequestResponseFactory({
      dispatcher: this.dispatcher,
      dispatcherNotReadyMessage: 'Express adapter received a request before dispatcher binding completed.',
      factory: this.requestResponseFactory,
      rawRequest: request,
      rawResponse: response,
    });
  }
}

function createExpressRequestResponseFactory(
  multipartOptions?: MultipartOptions,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  preserveRawBody = false,
): RequestResponseFactory<ExpressRequest, ExpressResponse, ExpressFrameworkResponse> {
  return {
    async createRequest(request: ExpressRequest, signal: AbortSignal) {
      return createFrameworkRequest(
        request,
        signal,
        multipartOptions,
        maxBodySize,
        preserveRawBody,
      );
    },
    createRequestSignal(response: ExpressResponse) {
      return createRequestSignal(response);
    },
    createResponse(response: ExpressResponse) {
      return createFrameworkResponse(response);
    },
    resolveRequestId(request: ExpressRequest) {
      return resolveRequestIdFromHeaders(request.headers);
    },
    async writeErrorResponse(error: unknown, response: ExpressFrameworkResponse, requestId?: string) {
      const httpError = toHttpException(error);
      response.setStatus(httpError.status);
      await response.send(createErrorResponse(httpError, requestId));
    },
  };
}

export function createExpressAdapter(
  options: ExpressAdapterOptions = {},
  multipartOptions?: MultipartOptions,
): HttpApplicationAdapter {
  return new ExpressHttpApplicationAdapter(
    resolvePort(options.port),
    options.host,
    options.retryDelayMs,
    options.retryLimit,
    options.https,
    multipartOptions,
    options.maxBodySize,
    options.rawBody,
    options.shutdownTimeoutMs,
  );
}

export async function bootstrapExpressApplication(
  rootModule: ModuleType,
  options: BootstrapExpressApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();

  return bootstrapApplication({
    ...options,
    adapter: createExpressAdapter(options, options.multipart),
    logger,
    middleware: createExpressMiddleware(options),
    rootModule,
  });
}

export async function runExpressApplication(
  rootModule: ModuleType,
  options: RunExpressApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  const adapter = createExpressAdapter(options, options.multipart) as ExpressHttpApplicationAdapter;
  const app = await bootstrapApplication({
    ...options,
    adapter,
    logger,
    middleware: createExpressMiddleware(options),
    rootModule,
  });

  try {
    await app.listen();
    logger.log(formatListenMessage(adapter.getListenTarget()), 'KonektiFactory');
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

  const unregisterShutdownSignals = registerShutdownSignals(
    app,
    logger,
    options.shutdownSignals ?? defaultShutdownSignals(),
    options.forceExitTimeoutMs,
  );
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

function createFrameworkResponse(response: ExpressResponse): ExpressFrameworkResponse {
  return {
    committed: response.headersSent || response.writableEnded,
    headers: {},
    raw: response,
    stream: createFrameworkResponseStream(response),
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
      response.redirect(status, location);
    },
    async send(body: unknown) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      const existingContentType = response.getHeader('content-type');
      const serialized = serializeResponseBody(body, typeof existingContentType === 'string' ? existingContentType : undefined);

      if (!response.hasHeader('content-type') && serialized.defaultContentType) {
        response.setHeader('content-type', serialized.defaultContentType);
      }

      this.committed = true;
      response.send(serialized.payload);
    },
    setHeader(name: string, value: string | string[]) {
      const lowerName = name.toLowerCase();

      if (lowerName === 'set-cookie') {
        const merged = mergeSetCookieHeader(response.getHeader(name), value);
        response.setHeader(name, merged);
        this.headers[name] = merged;
        return;
      }

      response.setHeader(name, value);
      this.headers[name] = value;
    },
    setStatus(code: number) {
      response.status(code);
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createFrameworkResponseStream(response: ExpressResponse): FrameworkResponseStream {
  return {
    close() {
      if (!response.writableEnded) {
        response.end();
      }
    },
    get closed() {
      return response.writableEnded;
    },
    flush() {
      response.flushHeaders?.();
    },
    onClose(listener: () => void) {
      response.on('close', listener);
      return () => {
        response.removeListener('close', listener);
      };
    },
    waitForDrain() {
      if (response.writableEnded) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        response.once('drain', () => resolve());
      });
    },
    write(chunk: string | Uint8Array) {
      return response.write(chunk);
    },
  };
}

async function createFrameworkRequest(
  request: ExpressRequest,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  preserveRawBody = false,
): Promise<FrameworkRequest> {
  const rawUrl = request.originalUrl || request.url || '/';
  const url = new URL(rawUrl, 'http://localhost');
  const headers = normalizeHeaders(request.headers);
  const contentType = readPrimaryHeaderValue(headers['content-type']);
  const isMultipart = typeof contentType === 'string' && contentType.includes('multipart/form-data');

  let body: unknown;
  let files: UploadedFile[] | undefined;
  let rawBody: Uint8Array | undefined;

  if (isMultipart) {
    const parsed = await parseMultipartRequest(request, multipartOptions);
    body = parsed.fields;
    files = parsed.files;
  } else {
    const bodyResult = await readRequestBody(request, headers['content-type'], maxBodySize, preserveRawBody);
    body = bodyResult.body;
    rawBody = bodyResult.rawBody;
  }

  const frameworkRequest: FrameworkRequest & { files?: UploadedFile[]; rawBody?: Uint8Array } = {
    body,
    cookies: parseCookieHeader(Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie),
    headers,
    method: request.method,
    params: {},
    path: url.pathname,
    query: parseQueryParams(url.searchParams),
    raw: request,
    signal,
    url: url.pathname + url.search,
  };

  if (files) {
    frameworkRequest.files = files;
  }

  if (rawBody) {
    frameworkRequest.rawBody = rawBody;
  }

  return frameworkRequest;
}

async function parseMultipartRequest(
  request: IncomingMessage,
  options: MultipartOptions = {},
): Promise<{ fields: Record<string, string | string[]>; files: UploadedFile[] }> {
  try {
    return await parseMultipart(request, options);
  } catch (error: unknown) {
    if (isExpressMultipartTooLargeError(error)) {
      if (error instanceof PayloadTooLargeException) {
        throw error;
      }

      throw new PayloadTooLargeException('Request body exceeds the configured multipart limits.');
    }

    throw error;
  }
}

export function isExpressMultipartTooLargeError(error: unknown): boolean {
  if (error instanceof PayloadTooLargeException) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as ExpressMultipartLikeError;

  if (candidate.statusCode === 413 || candidate.status === 413) {
    return true;
  }

  if (typeof candidate.code === 'string' && /LIMIT|TOO_LARGE|ENTITY_TOO_LARGE|FILE_TOO_LARGE/i.test(candidate.code)) {
    return true;
  }

  if (typeof candidate.type === 'string' && candidate.type.toLowerCase() === 'entity.too.large') {
    return true;
  }

  return error.message.toLowerCase().includes('too large');
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[name] = value;
      continue;
    }

    if (typeof value === 'number') {
      normalized[name] = String(value);
      continue;
    }

    if (typeof value === 'string' || value === undefined) {
      normalized[name] = value;
      continue;
    }

    normalized[name] = String(value);
  }

  return normalized;
}

function parseQueryParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const current = query[key];

    if (current === undefined) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }

    query[key] = [current, value];
  }

  return query;
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf('=');

        if (index === -1) {
          return [pair.trim(), ''] as [string, string];
        }

        const rawValue = pair.slice(index + 1).trim();

        try {
          return [pair.slice(0, index).trim(), decodeURIComponent(rawValue)] as [string, string];
        } catch {
          return [pair.slice(0, index).trim(), rawValue] as [string, string];
        }
      }),
  );
}

function createRequestSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  const abort = (reason: string) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  };

  response.once('close', () => {
    if (!response.writableEnded) {
      abort('Response closed before response commit.');
    }
  });

  return controller.signal;
}

function resolveRequestIdFromHeaders(headers: IncomingHttpHeaders): string | undefined {
  const requestId = headers['x-request-id'] ?? headers['x-correlation-id'];
  return Array.isArray(requestId) ? requestId[0] : requestId;
}

function createExpressMiddleware(options: BootstrapExpressApplicationOptions): MiddlewareLike[] {
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
    const defaultCorsOptions: CorsOptions = {
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['X-Request-Id'],
    };
    middleware.unshift(createCorsMiddleware(resolveCorsOptions(options.cors, defaultCorsOptions)));
  }

  return middleware;
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

function resolveCorsOptions(cors: Exclude<CorsInput, false> | undefined, defaults: CorsOptions): CorsOptions {
  if (cors === undefined) {
    return defaults;
  }

  if (typeof cors === 'string' || Array.isArray(cors)) {
    return { ...defaults, allowOrigin: cors };
  }

  return { ...defaults, ...cors };
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

function formatListenMessage(target: ExpressListenTarget): string {
  return target.url.endsWith(target.bindTarget)
    ? `Listening on ${target.url}`
    : `Listening on ${target.url} (bound to ${target.bindTarget})`;
}

function createExpressServer(httpsOptions: HttpsServerOptions | undefined, app: Express): ExpressServer {
  return httpsOptions ? createHttpsServer(httpsOptions, app) : createHttpServer(app);
}

function resolveListenTarget(
  address: AddressInfo | string | null,
  port: number,
  host: string | undefined,
  useHttps: boolean,
): ExpressListenTarget {
  const protocol = useHttps ? 'https' : 'http';
  const resolvedPort = typeof address === 'object' && address !== null ? address.port : port;
  const bindHost = typeof address === 'object' && address !== null ? address.address : host ?? '0.0.0.0';
  const publicHost = resolvePublicHost(host ?? bindHost);
  const bindTarget = `${formatHostForAuthority(bindHost)}:${String(resolvedPort)}`;
  const url = `${protocol}://${formatHostForAuthority(publicHost)}:${String(resolvedPort)}`;

  return { bindTarget, url };
}

function resolvePublicHost(host: string): string {
  return isWildcardHost(host) ? 'localhost' : host;
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

function formatHostForAuthority(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function resolvePort(value: number | undefined): number {
  const port = value ?? 3000;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${String(value ?? 3000)}.`);
  }

  return port;
}

function defaultShutdownSignals(): false | readonly ExpressApplicationSignal[] {
  return ['SIGINT', 'SIGTERM'];
}

function registerShutdownSignals(
  app: Application,
  logger: ApplicationLogger,
  signals: false | readonly ExpressApplicationSignal[],
  forceExitTimeoutMs: number = DEFAULT_FORCE_EXIT_TIMEOUT_MS,
): () => void {
  if (signals === false || signals.length === 0) {
    return () => {};
  }

  const seen = new Set<ExpressApplicationSignal>();
  const bindings: Array<{ signal: ExpressApplicationSignal; handler: () => void }> = [];

  for (const signal of signals) {
    if (seen.has(signal)) {
      continue;
    }

    seen.add(signal);
    const handler = () => {
      void closeFromSignal(app, logger, signal, forceExitTimeoutMs);
    };

    bindings.push({ signal, handler });
    process.once(signal, handler);
  }

  return () => {
    for (const binding of bindings) {
      process.off(binding.signal, binding.handler);
    }
  };
}

async function closeFromSignal(
  app: Application,
  logger: ApplicationLogger,
  signal: ExpressApplicationSignal,
  forceExitTimeoutMs: number,
): Promise<void> {
  if (app.state === 'closed') {
    process.exitCode = 0;
    return;
  }

  const forceExitTimer = setTimeout(() => {
    logger.error(`Forced exit after ${String(forceExitTimeoutMs)}ms shutdown timeout.`, undefined, 'KonektiFactory');
    process.exit(1);
  }, forceExitTimeoutMs);

  if (forceExitTimer.unref) {
    forceExitTimer.unref();
  }

  try {
    await app.close(signal);
    clearTimeout(forceExitTimer);
    logger.log(`Application closed after receiving ${signal}.`, 'KonektiFactory');
    process.exitCode = 0;
  } catch (error: unknown) {
    clearTimeout(forceExitTimer);
    logger.error('Failed to shut down the application cleanly.', error, 'KonektiFactory');
    process.exitCode = 1;
  }
}

async function listenServer(server: ExpressServer, port: number, host: string | undefined): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error);
    };

    const onListening = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    server.once('error', onError);
    server.once('listening', onListening);

    try {
      server.listen({ host, port });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function closeServerSilently(server: ExpressServer): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function closeServerWithDrain(
  server: ExpressServer,
  sockets: ReadonlySet<Socket>,
  shutdownTimeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      forceCloseConnections(server, sockets);
    }, shutdownTimeoutMs);

    const finish = (error?: Error | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    server.close((error) => {
      finish(error);
    });

    closeIdleConnections(server);
  });
}

function closeIdleConnections(server: ExpressServer): void {
  server.closeIdleConnections?.();
}

function forceCloseConnections(server: ExpressServer, sockets: ReadonlySet<Socket>): void {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
    return;
  }

  for (const socket of sockets) {
    socket.destroy();
  }
}

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  return new InternalServerErrorException('Internal server error.', {
    cause: error,
  });
}

function isAddressInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForCloseWithTimeout(closePromise: Promise<void>, timeoutMs: number): Promise<void> {
  return Promise.race([
    closePromise,
    new Promise<void>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`Express adapter shutdown timeout exceeded ${String(timeoutMs)}ms.`));
      }, timeoutMs);
    }),
  ]);
}

function mergeSetCookieHeader(
  current: string | string[] | number | undefined,
  incoming: string | string[],
): string | string[] {
  const nextValues = Array.isArray(incoming) ? incoming : [incoming];

  if (current === undefined || typeof current === 'number') {
    return nextValues.length === 1 ? nextValues[0] : [...nextValues];
  }

  const currentValues = Array.isArray(current) ? current : [current];
  const merged = [...currentValues, ...nextValues];

  return merged.length === 1 ? merged[0] : merged;
}

async function readRequestBody(
  request: IncomingMessage,
  contentType: string | string[] | undefined,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  preserveRawBody = false,
): Promise<{ body: unknown; rawBody?: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const bufferChunk: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalSize += bufferChunk.byteLength;

    if (totalSize > maxBodySize) {
      throw new PayloadTooLargeException('Request body exceeds the size limit.');
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return { body: undefined };
  }

  const rawBody = Buffer.concat(chunks);
  const bodyText = rawBody.toString('utf8');

  if (bodyText.length === 0) {
    return { body: undefined, rawBody: preserveRawBody ? rawBody : undefined };
  }

  const primaryContentType = readPrimaryHeaderValue(contentType);

  if (typeof primaryContentType === 'string' && primaryContentType.includes('application/json')) {
    try {
      return {
        body: JSON.parse(bodyText) as unknown,
        rawBody: preserveRawBody ? rawBody : undefined,
      };
    } catch {
      throw new BadRequestException('Request body contains invalid JSON.');
    }
  }

  if (typeof primaryContentType === 'string' && primaryContentType.includes('application/x-www-form-urlencoded')) {
    return {
      body: parseUrlEncodedBody(bodyText),
      rawBody: preserveRawBody ? rawBody : undefined,
    };
  }

  return {
    body: bodyText,
    rawBody: preserveRawBody ? rawBody : undefined,
  };
}

function parseUrlEncodedBody(bodyText: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  const searchParams = new URLSearchParams(bodyText);

  for (const [key, value] of searchParams.entries()) {
    setMultiValue(fields, key, value);
  }

  return fields;
}

function readPrimaryHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}

function setMultiValue(target: Record<string, string | string[]>, key: string, value: string): void {
  const existing = target[key];

  if (existing === undefined) {
    target[key] = value;
    return;
  }

  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }

  target[key] = [existing, value];
}

function serializeResponseBody(
  body: unknown,
  contentType?: string,
): { defaultContentType?: string; payload: Buffer | string } {
  if (body === undefined) {
    return { payload: '' };
  }

  if (Buffer.isBuffer(body)) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: body,
    };
  }

  if (body instanceof Uint8Array) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: Buffer.from(body),
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: Buffer.from(body),
    };
  }

  if (typeof body === 'string') {
    const isJson = isJsonContentType(contentType);

    return {
      defaultContentType: isJson ? undefined : 'text/plain; charset=utf-8',
      payload: isJson ? JSON.stringify(body) : body,
    };
  }

  return {
    defaultContentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(body),
  };
}

function isJsonContentType(contentType: string | undefined): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}
