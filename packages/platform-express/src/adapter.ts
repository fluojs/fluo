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
import { Readable } from 'node:stream';
import { URL } from 'node:url';

import express, {
  type Express,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from 'express';

import {
  BadRequestException,
  createServerBackedHttpAdapterRealtimeCapability,
  createErrorResponse,
  HttpException,
  InternalServerErrorException,
  PayloadTooLargeException,
  type CorsOptions,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
  type HandlerDescriptor,
  type HttpApplicationAdapter,
  type MiddlewareLike,
  type SecurityHeadersOptions,
} from '@fluojs/http';
import {
  attachFrameworkRequestNativeRouteHandoff,
  bindRawRequestNativeRouteHandoff,
  consumeRawRequestNativeRouteHandoff,
  isRoutePathNormalizationSensitive,
} from '@fluojs/http/internal';
import type {
  Application,
  ApplicationLogger,
  CreateApplicationOptions,
  ModuleType,
  MultipartOptions,
  UploadedFile,
} from '@fluojs/runtime';
import {
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
} from '@fluojs/runtime/node';
import { parseMultipart } from '@fluojs/runtime/web';
import {
  bootstrapHttpAdapterApplication,
  runHttpAdapterApplication,
} from '@fluojs/runtime/internal/http-adapter';
import {
  dispatchWithRequestResponseFactory,
  type RequestResponseFactory,
} from '@fluojs/runtime/internal/request-response-factory';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

/**
 * Describes the express adapter options contract.
 */
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

/**
 * Defines the express application signal type.
 */
export type ExpressApplicationSignal = 'SIGINT' | 'SIGTERM';
/**
 * Defines the cors input type.
 */
export type CorsInput = false | string | string[] | CorsOptions;

const DEFAULT_MAX_BODY_SIZE = 1 * 1024 * 1024;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const EXPRESS_NATIVE_ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

type ExpressNativeRouteMethod = (typeof EXPRESS_NATIVE_ROUTE_METHODS)[number];

type RouteDescribingDispatcher = Dispatcher & {
  describeRoutes?: () => readonly HandlerDescriptor[];
};

/**
 * Describes the bootstrap express application options contract.
 */
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

/**
 * Describes the run express application options contract.
 */
export interface RunExpressApplicationOptions extends BootstrapExpressApplicationOptions {
  forceExitTimeoutMs?: number;
  shutdownSignals?: false | readonly ExpressApplicationSignal[];
}

interface ExpressListenTarget {
  bindTarget: string;
  url: string;
}

type ExpressServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

interface ExpressNativeRouteDefinition {
  descriptorsByMethod: Readonly<Partial<Record<ExpressNativeRouteMethod, HandlerDescriptor>>>;
  methods: readonly ExpressNativeRouteMethod[];
  path: string;
}

interface ExpressNativeRouteCandidate {
  descriptor: HandlerDescriptor;
  method: ExpressNativeRouteMethod;
  path: string;
  shapeKey: string;
}

type ExpressFrameworkResponse = FrameworkResponse & {
  raw: ExpressResponse;
  sendSimpleJson(body: Record<string, unknown> | unknown[]): ReturnType<FrameworkResponse['send']>;
  statusSet?: boolean;
};

type ExpressMultipartLikeError = Error & {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
};

/**
 * Represents the express http application adapter.
 */
export class ExpressHttpApplicationAdapter implements HttpApplicationAdapter {
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private readonly app: Express;
  private nativeRoutesReady = false;
  private readonly requestResponseFactory: RequestResponseFactory<
    ExpressRequest,
    ExpressResponse,
    ExpressFrameworkResponse
  >;
  private readonly router = express.Router();
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
    this.app.use(this.router);
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

  getRealtimeCapability() {
    return createServerBackedHttpAdapterRealtimeCapability(this.server);
  }

  getListenTarget(): ExpressListenTarget {
    return resolveListenTarget(this.server.address() ?? null, this.port, this.host, this.httpsOptions !== undefined);
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;
    this.registerNativeRoutes(dispatcher);
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

  private registerNativeRoutes(dispatcher: Dispatcher): void {
    if (this.nativeRoutesReady) {
      return;
    }

    const nativeRoutes = createExpressNativeRoutes(resolveDispatcherRouteDescriptors(dispatcher));
    Reflect.set(this.router, '__fluoNativeRoutes', nativeRoutes);

    for (const route of nativeRoutes) {
      this.router.all(route.path, (request: ExpressRequest, response: ExpressResponse, next: () => void) => {
        if (!route.methods.includes(request.method.toUpperCase() as ExpressNativeRouteMethod)) {
          next();
          return;
        }

        const nativeMethod = request.method.toUpperCase() as ExpressNativeRouteMethod;
        const requestPath = new URL(request.originalUrl || request.url || '/', 'http://localhost').pathname;
        const descriptor = route.descriptorsByMethod[nativeMethod];
        const params = normalizeNativeRouteParams(request.params);

        if (descriptor && !isRoutePathNormalizationSensitive(requestPath) && !hasNativeRouteParamSeparators(params)) {
          bindRawRequestNativeRouteHandoff(request, {
            descriptor,
            params,
          });
        }

        void this.handleRequest(request, response);
      });
    }

    this.nativeRoutesReady = true;
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

function resolveDispatcherRouteDescriptors(dispatcher: Dispatcher): readonly HandlerDescriptor[] {
  return (dispatcher as RouteDescribingDispatcher).describeRoutes?.() ?? [];
}

function createExpressNativeRoutes(descriptors: readonly HandlerDescriptor[]): ExpressNativeRouteDefinition[] {
  const candidates = new Map<string, ExpressNativeRouteCandidate>();
  const shapePaths = new Map<string, Set<string>>();
  const versionSensitiveRouteKeys = collectVersionSensitiveRouteKeys(descriptors);

  for (const descriptor of descriptors) {
    if (!isExpressNativeRouteDescriptor(descriptor)
      || versionSensitiveRouteKeys.has(`${descriptor.route.method}:${descriptor.route.path}`)) {
      continue;
    }

    registerExpressNativeRouteCandidate(candidates, shapePaths, descriptor);
  }

  const routesByPath = new Map<string, {
    descriptorsByMethod: Partial<Record<ExpressNativeRouteMethod, HandlerDescriptor>>;
    methods: Set<ExpressNativeRouteMethod>;
  }>();

  for (const candidate of candidates.values()) {
    if (shapePaths.get(candidate.shapeKey)?.size !== 1) {
      continue;
    }

    let route = routesByPath.get(candidate.path);

    if (!route) {
      route = {
        descriptorsByMethod: {},
        methods: new Set<ExpressNativeRouteMethod>(),
      };
      routesByPath.set(candidate.path, route);
    }

    route.methods.add(candidate.method);
    route.descriptorsByMethod[candidate.method] = candidate.descriptor;
  }

  return [...routesByPath.entries()].map(([path, route]) => ({
    descriptorsByMethod: route.descriptorsByMethod,
    methods: [...route.methods],
    path,
  }));
}

function isExpressNativeRouteDescriptor(descriptor: HandlerDescriptor): descriptor is HandlerDescriptor & {
  route: HandlerDescriptor['route'] & { method: ExpressNativeRouteMethod };
} {
  return descriptor.route.method !== 'ALL'
    && EXPRESS_NATIVE_ROUTE_METHODS.includes(descriptor.route.method as ExpressNativeRouteMethod)
    && descriptor.route.version === undefined;
}

function registerExpressNativeRouteCandidate(
  candidates: Map<string, ExpressNativeRouteCandidate>,
  shapePaths: Map<string, Set<string>>,
  descriptor: HandlerDescriptor & {
    route: HandlerDescriptor['route'] & { method: ExpressNativeRouteMethod };
  },
): void {
  const nativeMethod = descriptor.route.method;
  const path = descriptor.route.path;
  const routeKey = `${nativeMethod}:${path}`;
  const shapeKey = `${nativeMethod}:${canonicalizeExpressRouteShape(path)}`;

  if (!candidates.has(routeKey)) {
    candidates.set(routeKey, {
      descriptor,
      method: nativeMethod,
      path,
      shapeKey,
    });
  }

  let paths = shapePaths.get(shapeKey);

  if (!paths) {
    paths = new Set<string>();
    shapePaths.set(shapeKey, paths);
  }

  paths.add(path);
}

function canonicalizeExpressRouteShape(path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.startsWith(':') ? ':' : segment);

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
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

/**
 * Create express adapter.
 *
 * @param options The options.
 * @param multipartOptions The multipart options.
 * @returns The create express adapter result.
 */
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

/**
 * Bootstrap express application.
 *
 * @param rootModule The root module.
 * @param options The options.
 * @returns The bootstrap express application result.
 */
export async function bootstrapExpressApplication(
  rootModule: ModuleType,
  options: BootstrapExpressApplicationOptions,
): Promise<Application> {
  return bootstrapHttpAdapterApplication(
    rootModule,
    options,
    createExpressAdapter(options, options.multipart),
  );
}

/**
 * Run express application.
 *
 * @param rootModule The root module.
 * @param options The options.
 * @returns The run express application result.
 */
export async function runExpressApplication(
  rootModule: ModuleType,
  options: RunExpressApplicationOptions,
): Promise<Application> {
  const adapter = createExpressAdapter(options, options.multipart) as ExpressHttpApplicationAdapter;
  return runHttpAdapterApplication(rootModule, {
    ...options,
    shutdownRegistration: createNodeShutdownSignalRegistration(
      options.shutdownSignals ?? defaultNodeShutdownSignals(),
    ),
  }, adapter);
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
    async sendSimpleJson(body: Record<string, unknown> | unknown[]) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      const serialized = serializeResponseBody(body);

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
      if (response.writableEnded || response.destroyed) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const settle = () => {
          response.removeListener('drain', settle);
          response.removeListener('close', settle);
          response.removeListener('error', settle);
          resolve();
        };

        response.once('drain', settle);
        response.once('close', settle);
        response.once('error', settle);
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
    const parsed = await parseMultipartRequest(request, {
      ...multipartOptions,
      maxTotalSize: multipartOptions?.maxTotalSize ?? maxBodySize,
    });
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

  const nativeRouteHandoff = consumeRawRequestNativeRouteHandoff(request);

  return nativeRouteHandoff
    ? attachFrameworkRequestNativeRouteHandoff(frameworkRequest, nativeRouteHandoff)
    : frameworkRequest;
}

function normalizeNativeRouteParams(params: unknown): Record<string, string> {
  if (typeof params !== 'object' || params === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[key, value] as const]
        : value === undefined
          ? []
          : [[key, String(value)] as const]),
  );
}

function hasNativeRouteParamSeparators(params: Readonly<Record<string, string>>): boolean {
  return Object.values(params).some((value) => value.includes('/'));
}

function collectVersionSensitiveRouteKeys(descriptors: readonly HandlerDescriptor[]): Set<string> {
  const grouped = new Map<string, { count: number; hasVersioned: boolean }>();

  for (const descriptor of descriptors) {
    if (!EXPRESS_NATIVE_ROUTE_METHODS.includes(descriptor.route.method as ExpressNativeRouteMethod)) {
      continue;
    }

    const routeKey = `${descriptor.route.method}:${descriptor.route.path}`;
    const current = grouped.get(routeKey) ?? { count: 0, hasVersioned: false };
    current.count += 1;
    current.hasVersioned ||= descriptor.route.version !== undefined;
    grouped.set(routeKey, current);
  }

  return new Set(
    [...grouped.entries()]
      .filter(([, current]) => current.count > 1 || current.hasVersioned)
      .map(([routeKey]) => routeKey),
  );
}

async function parseMultipartRequest(
  request: IncomingMessage,
  options: MultipartOptions = {},
): Promise<{ fields: Record<string, string | string[]>; files: UploadedFile[] }> {
  try {
    return await parseMultipart(
      {
        body: Readable.toWeb(request),
        headers: normalizeHeaders(request.headers),
        method: request.method,
        url: new URL(request.url ?? '/', 'http://localhost').toString(),
      },
      options,
    );
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

/**
 * Is express multipart too large error.
 *
 * @param error The error.
 * @returns The is express multipart too large error result.
 */
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
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Express adapter shutdown timeout exceeded ${String(timeoutMs)}ms.`));
    }, timeoutMs);

    void closePromise.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
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
