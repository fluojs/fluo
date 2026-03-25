import type { IncomingHttpHeaders } from 'node:http';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import type { AddressInfo } from 'node:net';

import multipart from '@fastify/multipart';
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';

import {
  createCorsMiddleware,
  createErrorResponse,
  createSecurityHeadersMiddleware,
  HttpException,
  InternalServerErrorException,
  matchRoutePattern,
  NotFoundException,
  normalizeRoutePattern,
  PayloadTooLargeException,
  type CorsOptions,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type MiddlewareLike,
  type MiddlewareContext,
  type Next,
  type SecurityHeadersOptions,
} from '@konekti/http';
import {
  bootstrapApplication,
  createConsoleApplicationLogger,
  type Application,
  type ApplicationLogger,
  type CreateApplicationOptions,
  type ModuleType,
  type MultipartOptions,
  type UploadedFile,
} from '@konekti/runtime';

declare module '@konekti/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

export interface FastifyAdapterOptions {
  host?: string;
  https?: HttpsServerOptions;
  maxBodySize?: number;
  port?: number;
  rawBody?: boolean;
  retryDelayMs?: number;
  retryLimit?: number;
  shutdownTimeoutMs?: number;
}

export type FastifyApplicationSignal = 'SIGINT' | 'SIGTERM';
export type CorsInput = false | string | string[] | CorsOptions;

const DEFAULT_MAX_BODY_SIZE = 1 * 1024 * 1024;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface BootstrapFastifyApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
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

export interface RunFastifyApplicationOptions extends BootstrapFastifyApplicationOptions {
  shutdownSignals?: false | readonly FastifyApplicationSignal[];
}

interface FastifyListenTarget {
  bindTarget: string;
  url: string;
}

type FastifyFrameworkResponse = FrameworkResponse & {
  raw: FastifyReply;
  statusSet?: boolean;
};

export class FastifyHttpApplicationAdapter implements HttpApplicationAdapter {
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private pluginsReady = false;
  private readonly app: ReturnType<typeof fastify>;

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
    this.app = createFastifyApp(this.httpsOptions, this.maxBodySize);
  }

  getServer(): unknown {
    return this.app.server;
  }

  getListenTarget(): FastifyListenTarget {
    return resolveListenTarget(this.app.server.address() ?? null, this.port, this.host, this.httpsOptions !== undefined);
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;
    await this.registerPluginsAndRoute();
    await this.listenWithRetry();
  }

  async close(): Promise<void> {
    if (!this.app.server.listening) {
      this.dispatcher = undefined;
      return;
    }

    if (!this.closeInFlight) {
      const closePromise = this.app.close();
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

  private async registerPluginsAndRoute(): Promise<void> {
    if (this.pluginsReady) {
      return;
    }

    await this.app.register(multipart);

    if (this.preserveRawBody) {
      await this.app.register(fastifyRawBody, {
        encoding: 'utf8',
        field: 'rawBody',
        global: true,
        runFirst: true,
      });
    }

    this.app.all('*', async (request: FastifyRequest, reply: FastifyReply) => {
      await this.handleRequest(request, reply);
    });

    this.pluginsReady = true;
  }

  private async listenWithRetry(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.app.listen({
          host: this.host,
          port: this.port,
        });
        return;
      } catch (error: unknown) {
        if (!isAddressInUseError(error) || attempt >= this.retryLimit) {
          throw error;
        }

        await delay(this.retryDelayMs);
      }
    }
  }

  private async handleRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const frameworkResponse = createFrameworkResponse(reply);
    const signal = createRequestSignal(reply.raw);

    try {
      await this.dispatchRequest(request, signal, frameworkResponse);
    } catch (error: unknown) {
      await this.handleRequestError(error, request, signal, frameworkResponse);
    }
  }

  private async dispatchRequest(
    request: FastifyRequest,
    signal: AbortSignal,
    frameworkResponse: FastifyFrameworkResponse,
  ): Promise<void> {
    const frameworkRequest = await createFrameworkRequest(
      request,
      signal,
      this.multipartOptions,
      this.preserveRawBody,
    );

    const dispatcher = this.dispatcher;

    if (!dispatcher) {
      throw new Error('Fastify adapter received a request before dispatcher binding completed.');
    }

    await dispatcher.dispatch(frameworkRequest, frameworkResponse);

    if (!frameworkResponse.committed) {
      await frameworkResponse.send(undefined);
    }
  }

  private async handleRequestError(
    error: unknown,
    request: FastifyRequest,
    signal: AbortSignal,
    frameworkResponse: FastifyFrameworkResponse,
  ): Promise<void> {
    if (signal.aborted || frameworkResponse.committed) {
      return;
    }

    const requestId = resolveRequestIdFromHeaders(request.raw.headers);
    const httpError = toHttpException(error);
    frameworkResponse.setStatus(httpError.status);
    await frameworkResponse.send(createErrorResponse(httpError, requestId));
  }
}

export function createFastifyAdapter(
  options: FastifyAdapterOptions = {},
  multipartOptions?: MultipartOptions,
): HttpApplicationAdapter {
  return new FastifyHttpApplicationAdapter(
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

export async function bootstrapFastifyApplication(
  rootModule: ModuleType,
  options: BootstrapFastifyApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();

  return bootstrapApplication({
    ...options,
    adapter: createFastifyAdapter(options, options.multipart),
    logger,
    middleware: createFastifyMiddleware(options),
    rootModule,
  });
}

export async function runFastifyApplication(
  rootModule: ModuleType,
  options: RunFastifyApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  const adapter = createFastifyAdapter(options, options.multipart) as FastifyHttpApplicationAdapter;
  const app = await bootstrapApplication({
    ...options,
    adapter,
    logger,
    middleware: createFastifyMiddleware(options),
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

  registerShutdownSignals(app, logger, options.shutdownSignals ?? defaultShutdownSignals());

  return app;
}

function createFrameworkResponse(reply: FastifyReply): FastifyFrameworkResponse {
  return {
    committed: reply.sent,
    headers: {},
    raw: reply,
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
      reply.status(status);
      reply.redirect(location);
    },
    async send(body: unknown) {
      if (reply.sent) {
        this.committed = true;
        return;
      }

      const existingContentType = reply.getHeader('content-type');
      const serialized = serializeResponseBody(body, typeof existingContentType === 'string' ? existingContentType : undefined);

      if (!reply.hasHeader('content-type') && serialized.defaultContentType) {
        reply.header('content-type', serialized.defaultContentType);
      }

      this.committed = true;
      await reply.send(serialized.payload);
    },
    setHeader(name: string, value: string | string[]) {
      const lowerName = name.toLowerCase();

      if (lowerName === 'set-cookie') {
        const merged = mergeSetCookieHeader(reply.getHeader(name), value);
        reply.header(name, merged);
        this.headers[name] = merged;
        return;
      }

      reply.header(name, value);
      this.headers[name] = value;
    },
    setStatus(code: number) {
      reply.status(code);
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

async function createFrameworkRequest(
  request: FastifyRequest,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  preserveRawBody = false,
): Promise<FrameworkRequest> {
  const rawUrl = request.raw.url ?? '/';
  const url = new URL(rawUrl, 'http://localhost');
  const headers = normalizeHeaders(request.headers);
  const contentType = headers['content-type'];
  const isMultipart = typeof contentType === 'string' && contentType.includes('multipart/form-data');

  let body = request.body;
  let files: UploadedFile[] | undefined;

  if (isMultipart) {
    const parsed = await parseMultipartRequest(request, multipartOptions);
    body = parsed.fields;
    files = parsed.files;
  }

  const frameworkRequest: FrameworkRequest = {
    body,
    cookies: parseCookieHeader(headers.cookie),
    headers,
    method: request.method,
    params: {},
    path: url.pathname,
    query: parseQueryParams(url.searchParams),
    raw: request.raw,
    signal,
    url: url.pathname + url.search,
  };

  if (files) {
    frameworkRequest.files = files;
  }

  if (preserveRawBody && !isMultipart) {
    const rawBodyValue = (request as FastifyRequest & { rawBody?: Buffer | string }).rawBody;

    if (rawBodyValue !== undefined) {
      frameworkRequest.rawBody = typeof rawBodyValue === 'string' ? Buffer.from(rawBodyValue, 'utf8') : rawBodyValue;
    }
  }

  return frameworkRequest;
}

async function parseMultipartRequest(
  request: FastifyRequest,
  options: MultipartOptions = {},
): Promise<{ fields: Record<string, string | string[]>; files: UploadedFile[] }> {
  const fields: Record<string, string | string[]> = {};
  const files: UploadedFile[] = [];
  const maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 10;

  try {
    for await (const part of request.parts({
      limits: {
        fileSize: maxFileSize,
        files: maxFiles,
      },
    })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        files.push({
          buffer,
          fieldname: part.fieldname,
          mimetype: part.mimetype,
          originalname: part.filename,
          size: buffer.byteLength,
        });

        if (files.length > maxFiles) {
          throw new PayloadTooLargeException(`Exceeded maximum file count of ${String(maxFiles)}.`);
        }

        continue;
      }

      setMultiValue(fields, part.fieldname, String(part.value ?? ''));
    }
  } catch (error: unknown) {
    if (isFastifyMultipartTooLargeError(error)) {
      throw new PayloadTooLargeException('Request body exceeds the configured multipart limits.');
    }

    throw error;
  }

  return { fields, files };
}

function isFastifyMultipartTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'FastifyError' || error.message.includes('toobig') || error.message.includes('File too large');
}

function normalizeHeaders(headers: FastifyRequest['headers']): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[name] = value.join(', ');
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

        return [pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1).trim())] as [string, string];
      }),
  );
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

function createRequestSignal(response: import('node:http').ServerResponse): AbortSignal {
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

function createFastifyMiddleware(options: BootstrapFastifyApplicationOptions): MiddlewareLike[] {
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
      const restore = applyScopedGlobalPrefixRequest(context, requestPath, strippedPath);

      try {
        await next();
      } finally {
        restore();
      }
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

function applyScopedGlobalPrefixRequest(
  context: MiddlewareContext,
  requestPath: string,
  strippedPath: string,
): () => void {
  const originalRequest = context.requestContext.request;
  const scopedRequest = rewriteGlobalPrefixRequest(originalRequest, requestPath, strippedPath);

  context.request = scopedRequest;
  context.requestContext.request = scopedRequest;

  return () => {
    context.request = originalRequest;
    context.requestContext.request = originalRequest;
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

function formatListenMessage(target: FastifyListenTarget): string {
  return target.url.endsWith(target.bindTarget)
    ? `Listening on ${target.url}`
    : `Listening on ${target.url} (bound to ${target.bindTarget})`;
}

function createFastifyApp(
  httpsOptions: HttpsServerOptions | undefined,
  maxBodySize: number,
): ReturnType<typeof fastify> {
  if (httpsOptions) {
    return fastify({
      bodyLimit: maxBodySize,
      https: httpsOptions,
      logger: false,
    } as Parameters<typeof fastify>[0]);
  }

  return fastify({
    bodyLimit: maxBodySize,
    logger: false,
  });
}

function resolveListenTarget(
  address: AddressInfo | string | null,
  port: number,
  host: string | undefined,
  useHttps: boolean,
): FastifyListenTarget {
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
  const port = value ?? Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${String(value ?? process.env.PORT ?? 3000)}.`);
  }

  return port;
}

function defaultShutdownSignals(): false | readonly FastifyApplicationSignal[] {
  return ['SIGINT', 'SIGTERM'];
}

function registerShutdownSignals(
  app: Application,
  logger: ApplicationLogger,
  signals: false | readonly FastifyApplicationSignal[],
): void {
  if (signals === false || signals.length === 0) {
    return;
  }

  const seen = new Set<FastifyApplicationSignal>();

  for (const signal of signals) {
    if (seen.has(signal)) {
      continue;
    }

    seen.add(signal);
    process.once(signal, () => {
      void app.close(signal)
        .then(() => {
          logger.log(`Application closed after receiving ${signal}.`, 'KonektiFactory');
        })
        .catch((error: unknown) => {
          logger.error(`Failed to close application after receiving ${signal}.`, error, 'KonektiFactory');
        });
    });
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
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
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
