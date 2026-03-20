import { createServer as createHttpServer, type RequestListener } from 'node:http';
import { createServer as createHttpsServer, type ServerOptions as HttpsServerOptions } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { URL } from 'node:url';

import {
  BadRequestException,
  createCorsMiddleware,
  createErrorResponse,
  createSecurityHeadersMiddleware,
  HttpException,
  InternalServerException,
  NotFoundException,
  PayloadTooLargeException,
  type CorsOptions,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type MiddlewareLike,
  type SecurityHeadersOptions,
} from '@konekti/http';

import { bootstrapApplication } from './bootstrap.js';
import { compressResponse } from './compression.js';
import { createConsoleApplicationLogger } from './logger.js';
import { parseMultipart, type MultipartOptions, type UploadedFile } from './multipart.js';
import type { Application, ApplicationLogger, CreateApplicationOptions, ModuleType } from './types.js';

declare module '@konekti/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
  }
}

export interface NodeHttpAdapterOptions {
  host?: string;
  https?: HttpsServerOptions;
  maxBodySize?: number;
  port?: number;
  rawBody?: boolean;
  retryDelayMs?: number;
  retryLimit?: number;
  shutdownTimeoutMs?: number;
}

export type NodeApplicationSignal = 'SIGINT' | 'SIGTERM';

export type CorsInput = false | string | string[] | CorsOptions;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_GLOBAL_PREFIX_EXCLUDE = ['/health', '/ready', '/openapi.json', '/docs', '/metrics'] as const;

export interface BootstrapNodeApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  compression?: boolean;
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

export interface RunNodeApplicationOptions extends BootstrapNodeApplicationOptions {
  shutdownSignals?: false | readonly NodeApplicationSignal[];
}

type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

interface NodeListenTarget {
  bindTarget: string;
  url: string;
}

type NodeServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
type NodeRequestListener = RequestListener;

export class NodeHttpApplicationAdapter implements HttpApplicationAdapter {
  private readonly server: NodeServer;
  private dispatcher?: Dispatcher;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly port: number,
    private readonly host: string | undefined,
    private readonly retryDelayMs = 150,
    private readonly retryLimit = 20,
    private readonly compression = false,
    private readonly httpsOptions: HttpsServerOptions | undefined,
    private readonly multipartOptions?: MultipartOptions,
    private readonly maxBodySize = 1 * 1024 * 1024,
    private readonly preserveRawBody = false,
    private readonly shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {
    this.server = createNodeServer(this.httpsOptions, (request, response) => {
      void this.handleRequest(request, response);

    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  getServer(): NodeServer {
    return this.server;
  }

  getListenTarget(): NodeListenTarget {
    return resolveNodeListenTarget(this.server.address() ?? null, this.port, this.host, this.httpsOptions !== undefined);
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;
    const server = this.server;

    await new Promise<void>((resolve, reject) => {
      const tryListen = (attempt: number) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);

          if (error.code === 'EADDRINUSE' && attempt < this.retryLimit) {
            server.close(() => {
              setTimeout(() => {
                tryListen(attempt + 1);
              }, this.retryDelayMs);
            });
            return;
          }

          reject(error);
        };

        const onListening = () => {
          server.off('error', onError);
          resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host: this.host, port: this.port });
      };

      tryListen(0);
    });
  }

  async close(): Promise<void> {
    const server = this.server;

    if (!server.listening) {
      this.dispatcher = undefined;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        forceCloseConnections(server, this.sockets);
      }, this.shutdownTimeoutMs);

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

    this.dispatcher = undefined;
  }

  private async handleRequest(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const frameworkResponse = createFrameworkResponse(response, this.compression ? request.headers['accept-encoding'] as string | undefined : undefined);
    const signal = createRequestSignal(response);
    let frameworkRequest: FrameworkRequest | undefined;

    try {
      frameworkRequest = await createFrameworkRequest(
        request,
        signal,
        this.multipartOptions,
        this.maxBodySize,
        this.preserveRawBody,
      );

      if (!this.dispatcher) {
        throw new Error('Node HTTP adapter received a request before dispatcher binding completed.');
      }

      await this.dispatcher.dispatch(frameworkRequest, frameworkResponse);

      if (!frameworkResponse.committed) {
        await frameworkResponse.send(undefined);
      }
    } catch (error: unknown) {
      if (signal.aborted || frameworkResponse.committed) {
        return;
      }

      const requestId = resolveRequestIdFromHeaders(request.headers);
      await writeNodeAdapterErrorResponse(error, frameworkResponse, requestId);
    }
  }
}

export function createNodeHttpAdapter(options: NodeHttpAdapterOptions = {}, compression = false, multipartOptions?: MultipartOptions): HttpApplicationAdapter {
  return new NodeHttpApplicationAdapter(
    resolveNodePort(options.port),
    options.host,
    options.retryDelayMs,
    options.retryLimit,
    compression,
    options.https,
    multipartOptions,
    options.maxBodySize,
    options.rawBody,
    options.shutdownTimeoutMs,
  );
}

export async function bootstrapNodeApplication(
  rootModule: ModuleType,
  options: BootstrapNodeApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();

  return bootstrapApplication({
    ...options,
    adapter: createNodeHttpAdapter(options, options.compression ?? false, options.multipart),
    logger,
    middleware: createNodeMiddleware(options),
    rootModule,
  });
}

export async function runNodeApplication(
  rootModule: ModuleType,
  options: RunNodeApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  const adapter = createNodeHttpAdapter(options, options.compression ?? false, options.multipart) as NodeHttpApplicationAdapter;
  const app = await bootstrapApplication({
    ...options,
    adapter,
    logger,
    middleware: createNodeMiddleware(options),
    rootModule,
  });

  try {
    await app.listen();
    logger.log(formatListenMessage(adapter.getListenTarget()), 'KonektiFactory');
  } catch (error: unknown) {
    logger.error('Failed to start application.', error, 'KonektiFactory');

    if (app.state !== 'closed') {
      await app.close('bootstrap-failed');
    }

    throw error;
  }

  registerShutdownSignals(app, logger, options.shutdownSignals ?? defaultShutdownSignals(options.mode));

  return app;
}

function createNodeServer(
  httpsOptions: HttpsServerOptions | undefined,
  handler: NodeRequestListener,
): NodeServer {
  return httpsOptions ? createHttpsServer(httpsOptions, handler) : createHttpServer(handler);
}

function formatListenMessage(target: NodeListenTarget): string {
  return target.url.endsWith(target.bindTarget)
    ? `Listening on ${target.url}`
    : `Listening on ${target.url} (bound to ${target.bindTarget})`;
}

function resolveNodeListenTarget(
  address: AddressInfo | string | null,
  port: number,
  host: string | undefined,
  useHttps: boolean,
): NodeListenTarget {
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

function createFrameworkResponse(response: import('node:http').ServerResponse, acceptEncoding?: string): MutableFrameworkResponse {
  const frameworkResponse: MutableFrameworkResponse & { raw: import('node:http').ServerResponse } = {
    committed: response.headersSent || response.writableEnded,
    headers: {},
    raw: response,
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      void this.send(undefined);
    },
    send(body: unknown) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      const existingContentType = response.getHeader('Content-Type');
      const serialized = serializeResponseBody(
        body,
        typeof existingContentType === 'string' ? existingContentType : undefined,
      );

      if (!response.hasHeader('Content-Type') && serialized.defaultContentType) {
        response.setHeader('Content-Type', serialized.defaultContentType);
      }

      const contentType = response.getHeader('Content-Type') as string | undefined;
      const payload = typeof serialized.payload === 'string'
        ? Buffer.from(serialized.payload, 'utf8')
        : serialized.payload;

      if (acceptEncoding && payload.byteLength >= 256) {
        this.committed = true;

        compressResponse(response, payload, acceptEncoding, contentType).catch(() => {
          if (!response.writableEnded) {
            response.end();
          }
        });

        return;
      }

      response.end(payload);
      this.committed = true;
    },
    setHeader(name: string, value: string) {
      response.setHeader(name, value);
      this.headers[name] = value;
    },
    setStatus(code: number) {
      response.statusCode = code;
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };

  return frameworkResponse;
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
    return {
      defaultContentType: isJsonContentType(contentType) ? undefined : 'text/plain; charset=utf-8',
      payload: isJsonContentType(contentType) ? JSON.stringify(body) : body,
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

async function createFrameworkRequest(
  request: import('node:http').IncomingMessage,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  maxBodySize = 1 * 1024 * 1024,
  preserveRawBody = false,
): Promise<FrameworkRequest> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
  );

  const contentType = headers['content-type'];
  const isMultipart = typeof contentType === 'string' && contentType.includes('multipart/form-data');

  let body: unknown;
  let files: UploadedFile[] | undefined;
  let rawBody: Uint8Array | undefined;

  if (isMultipart) {
    const result = await parseMultipart(request, multipartOptions);

    body = result.fields;
    files = result.files;
  } else {
    const bodyResult = await readRequestBody(request, headers['content-type'], maxBodySize, preserveRawBody);
    body = bodyResult.body;
    rawBody = bodyResult.rawBody;
  }

  const frameworkRequest: FrameworkRequest = {
    body,
    cookies: parseCookieHeader(headers['cookie']),
    headers,
    method: request.method ?? 'GET',
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

function createNodeMiddleware(options: BootstrapNodeApplicationOptions): MiddlewareLike[] {
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

    const corsOptions = resolveCorsOptions(options.cors, defaultCorsOptions);

    middleware.unshift(createCorsMiddleware(corsOptions));
  }

  return middleware;
}

function createGlobalPrefixMiddleware(prefix: string, exclude: readonly string[] | undefined): MiddlewareLike {
  const normalizedPrefix = normalizePathPattern(prefix);

  if (normalizedPrefix === '/') {
    return {
      async handle(_context, next) {
        await next();
      },
    };
  }

  const exclusions = [...DEFAULT_GLOBAL_PREFIX_EXCLUDE, ...(exclude ?? [])].map((path) => normalizePathPattern(path));

  return {
    async handle(context, next) {
      const requestPath = normalizePathPattern(context.request.path);

      if (matchesExcludedPath(requestPath, exclusions)) {
        await next();
        return;
      }

      if (!matchesPrefix(requestPath, normalizedPrefix)) {
        await writeGlobalPrefixNotFound(context.requestContext.requestId, context.response);
        return;
      }

      const strippedPath = stripGlobalPrefix(requestPath, normalizedPrefix);

      if (matchesExcludedPath(strippedPath, exclusions)) {
        await writeGlobalPrefixNotFound(context.requestContext.requestId, context.response);
        return;
      }

      context.request.path = strippedPath;
      context.request.url = rewritePrefixedUrl(context.request.url, requestPath, strippedPath);
      await next();
    },
  };
}

function writeGlobalPrefixNotFound(requestId: string | undefined, response: FrameworkResponse): Promise<void> {
  const error = new NotFoundException('Resource not found.');
  response.setStatus(error.status);
  return Promise.resolve(response.send(createErrorResponse(error, requestId)));
}

function normalizePathPattern(path: string): string {
  if (path.endsWith('/*')) {
    return `${normalizePathPattern(path.slice(0, -2))}/*`;
  }

  const segments = path.split('/').filter(Boolean);
  const normalized = `/${segments.join('/')}`;

  return normalized === '' ? '/' : normalized;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function stripGlobalPrefix(path: string, prefix: string): string {
  if (path === prefix) {
    return '/';
  }

  return normalizePathPattern(path.slice(prefix.length));
}

function matchesExcludedPath(path: string, exclusions: readonly string[]): boolean {
  return exclusions.some((pattern) => matchNodeRoutePattern(pattern, path));
}

function matchNodeRoutePattern(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }

  return path === pattern;
}

function rewritePrefixedUrl(url: string, originalPath: string, rewrittenPath: string): string {
  if (!url.startsWith(originalPath)) {
    return rewrittenPath;
  }

  return rewrittenPath + url.slice(originalPath.length);
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

        return [pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1).trim())] as [string, string];
      }),
  );
}

function createRequestSignal(
  response: import('node:http').ServerResponse,
): AbortSignal {
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

function closeIdleConnections(server: import('node:http').Server): void {
  server.closeIdleConnections?.();
}

function forceCloseConnections(server: import('node:http').Server, sockets: ReadonlySet<Socket>): void {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
    return;
  }

  for (const socket of sockets) {
    socket.destroy();
  }
}

function resolveRequestIdFromHeaders(headers: import('node:http').IncomingHttpHeaders): string | undefined {
  const requestId = headers['x-request-id'] ?? headers['x-correlation-id'];

  return Array.isArray(requestId) ? requestId[0] : requestId;
}

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  return new InternalServerException('Internal server error.', {
    cause: error,
  });
}

async function writeNodeAdapterErrorResponse(
  error: unknown,
  response: FrameworkResponse,
  requestId?: string,
): Promise<void> {
  const httpError = toHttpException(error);

  response.setStatus(httpError.status);
  await response.send(createErrorResponse(httpError, requestId));
}

function defaultShutdownSignals(mode: RunNodeApplicationOptions['mode']): false | readonly NodeApplicationSignal[] {
  return mode === 'test' ? false : ['SIGINT', 'SIGTERM'];
}

function registerShutdownSignals(
  app: Application,
  logger: ApplicationLogger,
  signals: false | readonly NodeApplicationSignal[],
): void {
  if (signals === false) {
    return;
  }

  for (const signal of signals) {
    process.once(signal, () => {
      void closeFromSignal(app, logger, signal);
    });
  }
}

async function closeFromSignal(app: Application, logger: ApplicationLogger, signal: NodeApplicationSignal): Promise<void> {
  if (app.state === 'closed') {
    process.exitCode = 0;
    return;
  }

  try {
    await app.close(signal);
    process.exitCode = 0;
  } catch (error: unknown) {
    logger.error('Failed to shut down the application cleanly.', error, 'KonektiFactory');
    process.exitCode = 1;
  }
}

async function readRequestBody(
  request: import('node:http').IncomingMessage,
  contentType: string | string[] | undefined,
  maxBodySize = 1 * 1024 * 1024,
  preserveRawBody = false,
): Promise<{ body: unknown; rawBody?: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const buf: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalSize += buf.byteLength;

    if (totalSize > maxBodySize) {
      throw new PayloadTooLargeException('Request body exceeds the size limit.');
    }

    chunks.push(buf);
  }

  if (chunks.length === 0) {
    return { body: undefined };
  }

  const rawBody = Buffer.concat(chunks);
  const bodyText = rawBody.toString('utf8');

  if (bodyText.length === 0) {
    return { body: undefined, rawBody: preserveRawBody ? rawBody : undefined };
  }

  const primaryContentType = Array.isArray(contentType) ? contentType[0] : contentType;

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

  return {
    body: bodyText,
    rawBody: preserveRawBody ? rawBody : undefined,
  };
}

function resolveNodePort(value: number | undefined): number {
  const port = value ?? Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${String(value ?? process.env.PORT ?? 3000)}.`);
  }

  return port;
}
