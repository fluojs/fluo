import type {
  CorsOptions,
  Dispatcher,
  HandlerDescriptor,
  HttpApplicationAdapter,
  HttpMethod,
  MiddlewareLike,
  SecurityHeadersOptions,
} from '@fluojs/http';
import { createFetchStyleHttpAdapterRealtimeCapability } from '@fluojs/http';
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
import { dispatchWebRequest } from '@fluojs/runtime/web';
import {
  bootstrapHttpAdapterApplication,
  runHttpAdapterApplication,
  type HttpAdapterListenTarget,
} from '@fluojs/runtime/internal/http-adapter';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

type BunGlobal = {
  serve(options: BunServeOptions): BunServerLike;
  version?: string;
};

type BunHostname = string;
type BunRequestLike = Request & {
  params?: Readonly<Record<string, string>>;
};
type BunRouteHandler = (
  request: BunRequestLike,
  server: BunServerLike,
) => Response | Promise<Response> | undefined | Promise<Response | undefined>;
type BunRouteMethod = Exclude<HttpMethod, 'ALL'>;
type BunRouteMethodMap = Partial<Record<BunRouteMethod, BunRouteHandler | Response>>;
type BunRouteValue = BunRouteHandler | Response | BunRouteMethodMap;

/** Shutdown signal names that `runBunApplication()` can register. */
export type BunApplicationSignal = 'SIGINT' | 'SIGTERM';

/** CORS input accepted by Bun application bootstrap helpers. */
export type BunCorsInput = false | string | string[] | CorsOptions;

/** TLS options forwarded to `Bun.serve()` without adapter-level normalization. */
export type BunTlsOptions = Record<string, unknown>;

/** Message payloads accepted by Bun server websocket bindings. */
export type BunWebSocketMessage = string | ArrayBuffer | Uint8Array;

/** Minimal Bun server websocket shape used by the official websocket binding seam. */
export interface BunServerWebSocket<TData = unknown> {
  readonly data: TData;
  readonly readyState: number;
  readonly remoteAddress: string;
  readonly subscriptions: string[];
  close(code?: number, reason?: string): void;
  cork(callback: (socket: BunServerWebSocket<TData>) => void): void;
  isSubscribed(topic: string): boolean;
  publish(topic: string, message: BunWebSocketMessage): void;
  send(message: BunWebSocketMessage, compress?: boolean): number;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

/** Callback contract forwarded to the `websocket` option of `Bun.serve()`. */
export interface BunWebSocketHandler<TData = unknown> {
  backpressureLimit?: number;
  close?(socket: BunServerWebSocket<TData>, code: number, reason: string): void | Promise<void>;
  closeOnBackpressureLimit?: boolean;
  data?: TData;
  drain?(socket: BunServerWebSocket<TData>): void | Promise<void>;
  error?(socket: BunServerWebSocket<TData>, error: Error): void | Promise<void>;
  idleTimeout?: number;
  maxPayloadLength?: number;
  message?(socket: BunServerWebSocket<TData>, message: BunWebSocketMessage): void | Promise<void>;
  open?(socket: BunServerWebSocket<TData>): void | Promise<void>;
  perMessageDeflate?:
    | boolean
    | {
        compress?: boolean | '128KB' | '16KB' | '256KB' | '32KB' | '3KB' | '4KB' | '64KB' | '8KB' | 'dedicated' | 'disable' | 'shared';
        decompress?: boolean | '128KB' | '16KB' | '256KB' | '32KB' | '3KB' | '4KB' | '64KB' | '8KB' | 'dedicated' | 'disable' | 'shared';
      };
  publishToSelf?: boolean;
  sendPings?: boolean;
}

/** Fetch-style websocket binding consumed before normal HTTP dispatch. */
export interface BunWebSocketBinding<TData = unknown> {
  fetch(request: Request, server: BunServerLike): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  idleTimeout?: number;
  maxRequestBodySize?: number;
  websocket: BunWebSocketHandler<TData>;
}

/** Host contract exposed by Bun adapters that can install a realtime binding. */
export interface BunRealtimeBindingHost {
  configureRealtimeBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void;
}

/** Backward-compatible host contract for Bun websocket-specific bindings. */
export interface BunWebSocketBindingHost extends BunRealtimeBindingHost {
  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void;
}

/** Subset of `Bun.serve()` options used by the adapter and its tests. */
export interface BunServeOptions {
  development?: boolean;
  error?: (error: Error) => Response | Promise<Response>;
  fetch(request: Request, server: BunServerLike): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  hostname?: BunHostname;
  idleTimeout?: number;
  maxRequestBodySize?: number;
  port?: number;
  routes?: Record<string, BunRouteValue>;
  tls?: BunTlsOptions;
  websocket?: BunWebSocketHandler;
}

/** Minimal Bun server handle used by fluo for fetch dispatch, upgrades, and shutdown. */
export interface BunServerLike {
  fetch?(request: Request): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  hostname?: BunHostname;
  port?: number;
  stop(closeActiveConnections?: boolean): void;
  upgrade<TData = unknown>(
    request: Request,
    options?: {
      data?: TData;
      headers?: HeadersInit;
    },
  ): boolean;
  url?: URL;
}

/** Options for `createBunAdapter()`. */
export interface BunAdapterOptions {
  /** Enables Bun development-mode behavior when supported by the host runtime. */
  development?: boolean;
  /** Hostname passed through to `Bun.serve()`. */
  hostname?: BunHostname;
  /** Idle timeout passed through to `Bun.serve()`. */
  idleTimeout?: number;
  /** Maximum request body size forwarded as Bun's `maxRequestBodySize`. */
  maxBodySize?: number;
  /** Multipart parsing limits used by the shared web request dispatcher. */
  multipart?: MultipartOptions;
  /** Port passed through to `Bun.serve()`, defaulting to 3000. */
  port?: number;
  /** Preserves raw bodies for non-multipart requests when enabled. */
  rawBody?: boolean;
  /** Whether shutdown asks Bun to stop active connections immediately. */
  stopActiveConnections?: boolean;
  /** TLS options forwarded to `Bun.serve()` for HTTPS startup. */
  tls?: BunTlsOptions;
}

/** Options for creating a standalone Bun `fetch(request)` handler. */
export interface CreateBunFetchHandlerOptions {
  /** Dispatcher that receives translated fluo framework requests. */
  dispatcher: Dispatcher;
  /** Error message used when a request arrives before dispatcher binding is ready. */
  dispatcherNotReadyMessage?: string;
  /** Maximum request body size enforced by the shared web dispatcher. */
  maxBodySize?: number;
  /** Multipart parsing limits used by the shared web dispatcher. */
  multipart?: MultipartOptions;
  /** Preserves raw bodies for JSON and text requests when enabled. */
  rawBody?: boolean;
}

/** Bootstrap options for Bun applications that do not install shutdown signal wiring. */
export interface BootstrapBunApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  /** CORS policy applied by the shared HTTP bootstrap path. */
  cors?: BunCorsInput;
  /** Enables Bun development-mode behavior when supported by the host runtime. */
  development?: boolean;
  /** Global route prefix applied by the shared HTTP bootstrap path. */
  globalPrefix?: string;
  /** Routes excluded from the global prefix. */
  globalPrefixExclude?: readonly string[];
  /** Hostname passed through to `Bun.serve()`. */
  hostname?: BunHostname;
  /** Idle timeout passed through to `Bun.serve()`. */
  idleTimeout?: number;
  /** Application logger used for startup, shutdown, and failure reporting. */
  logger?: ApplicationLogger;
  /** Maximum request body size forwarded as Bun's `maxRequestBodySize`. */
  maxBodySize?: number;
  /** Middleware applied by the shared HTTP bootstrap path. */
  middleware?: MiddlewareLike[];
  /** Multipart parsing limits used by the shared web request dispatcher. */
  multipart?: MultipartOptions;
  /** Port passed through to `Bun.serve()`, defaulting to 3000. */
  port?: number;
  /** Preserves raw bodies for non-multipart requests when enabled. */
  rawBody?: boolean;
  /** Security header policy applied by the shared HTTP bootstrap path. */
  securityHeaders?: false | SecurityHeadersOptions;
  /** Whether shutdown asks Bun to stop active connections immediately. */
  stopActiveConnections?: boolean;
  /** TLS options forwarded to `Bun.serve()` for HTTPS startup. */
  tls?: BunTlsOptions;
}

/** Run options for Bun applications with optional shutdown signal wiring. */
export interface RunBunApplicationOptions extends BootstrapBunApplicationOptions {
  /** Maximum signal-driven shutdown duration before fluo reports timeout via `process.exitCode`. */
  forceExitTimeoutMs?: number;
  /** Shutdown signals to register, or `false` to disable signal wiring. */
  shutdownSignals?: false | readonly BunApplicationSignal[];
}

const DEFAULT_PORT = 3000;
const DEFAULT_DISPATCHER_NOT_READY_MESSAGE = 'Bun adapter received a request before dispatcher binding completed.';
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const MINIMUM_BUN_NATIVE_ROUTES_VERSION = '1.2.3';
const BUN_WEBSOCKET_SUPPORT_REASON =
  'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @fluojs/websockets/bun for the official raw websocket binding.';

/** HTTP application adapter backed by native `Bun.serve()`. */
export class BunHttpApplicationAdapter implements HttpApplicationAdapter, BunWebSocketBindingHost {
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private inFlightDrain?: Deferred<void>;
  private inFlightRequestCount = 0;
  private server?: BunServerLike;
  private realtimeBinding?: BunWebSocketBinding<unknown>;

  constructor(private readonly options: BunAdapterOptions = {}) {}

  /** Returns the active Bun server handle after `listen()` starts. */
  getServer(): BunServerLike | undefined {
    return this.server;
  }

  /** Returns the bind target and externally logged URL for the current Bun server. */
  getListenTarget(): HttpAdapterListenTarget {
    const protocol = this.options.tls ? 'https' : 'http';
    const configuredHostname = this.options.hostname ?? 'localhost';
    const port = this.server?.port ?? this.options.port ?? DEFAULT_PORT;
    const url = this.server?.url?.origin ?? `${protocol}://${configuredHostname}:${String(port)}`;
    const bindHost = this.server?.hostname ?? this.options.hostname ?? configuredHostname;

    return {
      bindTarget: `${bindHost}:${String(port)}`,
      url,
    };
  }

  /** Reports Bun's fetch-style websocket capability for realtime package integration. */
  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      BUN_WEBSOCKET_SUPPORT_REASON,
      { support: 'supported' },
    );
  }

  /** Configures the official realtime binding before the Bun server starts. */
  configureRealtimeBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void {
    if (this.server && binding !== undefined) {
      throw new Error('Bun websocket binding must be configured before Bun adapter listen() starts the server.');
    }

    this.realtimeBinding = binding;
  }

  /** Configures a Bun websocket binding through the legacy websocket host name. */
  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void {
    this.configureRealtimeBinding(binding);
  }

  /** Starts the Bun server and binds framework dispatch to native fetch requests. */
  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;

    if (this.server) {
      return;
    }

    const bun = requireBunGlobal();
    const realtimeBinding = this.realtimeBinding;
    const handleRequest: BunRouteHandler = async (request, server) => {
      if (this.server === undefined) {
        this.server = server;
      }

      if (realtimeBinding) {
        const handled = await realtimeBinding.fetch(request, server);

        if (handled !== undefined || isWebSocketUpgradeRequest(request)) {
          return handled;
        }
      }

      return await this.dispatchHttpRequest(request);
    };

    this.server = bun.serve({
      development: this.options.development,
      fetch: handleRequest,
      hostname: this.options.hostname,
      idleTimeout: realtimeBinding?.idleTimeout ?? this.options.idleTimeout,
      maxRequestBodySize: realtimeBinding?.maxRequestBodySize ?? this.options.maxBodySize,
      port: resolvePort(this.options.port),
      routes: createBunNativeRoutes(dispatcher, handleRequest, bun),
      tls: this.options.tls,
      websocket: realtimeBinding?.websocket,
    });
  }

  /** Stops ingress, waits for in-flight HTTP handlers, and releases adapter state. */
  async close(): Promise<void> {
    if (this.closeInFlight) {
      await waitForCloseWithTimeout(this.closeInFlight, DEFAULT_SHUTDOWN_TIMEOUT_MS);
      return;
    }

    if (!this.server) {
      this.dispatcher = undefined;
      return;
    }

    const server = this.server;
    const closePromise = closeBunServerWithDrain(
      server,
      this.options.stopActiveConnections,
      () => this.waitForInFlightRequests(),
    );
    const closeInFlight = closePromise.finally(() => {
      if (this.server === server) {
        this.server = undefined;
      }

      this.closeInFlight = undefined;
      this.dispatcher = undefined;
    });

    this.closeInFlight = closeInFlight;
    void closeInFlight.catch(() => {});

    await waitForCloseWithTimeout(closeInFlight, DEFAULT_SHUTDOWN_TIMEOUT_MS);
  }

  private async dispatchHttpRequest(request: Request): Promise<Response> {
    if (this.closeInFlight) {
      return createShutdownResponse();
    }

    const release = this.trackInFlightRequest();

    try {
      return await dispatchWebRequest({
        dispatcher: this.dispatcher,
        dispatcherNotReadyMessage: DEFAULT_DISPATCHER_NOT_READY_MESSAGE,
        maxBodySize: this.options.maxBodySize,
        multipart: this.options.multipart,
        rawBody: this.options.rawBody,
        request,
      });
    } finally {
      release();
    }
  }

  private trackInFlightRequest(): () => void {
    this.inFlightRequestCount += 1;

    if (this.inFlightRequestCount === 1) {
      this.inFlightDrain = createDeferred<void>();
    }

    return () => {
      if (this.inFlightRequestCount === 0) {
        return;
      }

      this.inFlightRequestCount -= 1;

      if (this.inFlightRequestCount === 0) {
        this.inFlightDrain?.resolve();
        this.inFlightDrain = undefined;
      }
    };
  }

  private async waitForInFlightRequests(): Promise<void> {
    if (this.inFlightRequestCount === 0) {
      return;
    }

    await this.inFlightDrain?.promise;
  }
}

/**
 * Creates a standalone Bun-compatible fetch handler.
 *
 * @param options - Dispatcher and request parsing options for translating native requests.
 * @returns A `fetch(request)` handler suitable for custom `Bun.serve()` calls.
 */
export function createBunFetchHandler({
  dispatcher,
  dispatcherNotReadyMessage = DEFAULT_DISPATCHER_NOT_READY_MESSAGE,
  maxBodySize,
  multipart,
  rawBody,
}: CreateBunFetchHandlerOptions): (request: Request) => Promise<Response> {
  return async function bunFetchHandler(request: Request): Promise<Response> {
    return await dispatchWebRequest({
      dispatcher,
      dispatcherNotReadyMessage,
      maxBodySize,
      multipart,
      rawBody,
      request,
    });
  };
}

/**
 * Creates the recommended Bun HTTP adapter instance.
 *
 * @param options - Bun server and request parsing options.
 * @returns A fluo HTTP application adapter backed by `Bun.serve()`.
 */
export function createBunAdapter(options: BunAdapterOptions = {}): HttpApplicationAdapter {
  return new BunHttpApplicationAdapter(options);
}

/**
 * Bootstraps a fluo application with the Bun adapter without starting signal wiring.
 *
 * @param rootModule - Root fluo module to compile.
 * @param options - Bun adapter and application bootstrap options.
 * @returns The bootstrapped application; call `listen()` to start serving.
 */
export async function bootstrapBunApplication(
  rootModule: ModuleType,
  options: BootstrapBunApplicationOptions,
): Promise<Application> {
  return bootstrapHttpAdapterApplication(
    rootModule,
    options,
    createBunAdapter({
      development: options.development,
      hostname: options.hostname,
      idleTimeout: options.idleTimeout,
      maxBodySize: options.maxBodySize,
      multipart: options.multipart,
      port: options.port,
      rawBody: options.rawBody,
      stopActiveConnections: options.stopActiveConnections,
      tls: options.tls,
    }),
  );
}

/**
 * Bootstraps, starts, and wires shutdown handling for a Bun-hosted fluo application.
 *
 * @param rootModule - Root fluo module to compile.
 * @param options - Bun adapter, application, and shutdown options.
 * @returns The running application instance.
 */
export async function runBunApplication(
  rootModule: ModuleType,
  options: RunBunApplicationOptions,
): Promise<Application> {
  const adapter = createBunAdapter({
    development: options.development,
    hostname: options.hostname,
    idleTimeout: options.idleTimeout,
    maxBodySize: options.maxBodySize,
    multipart: options.multipart,
    port: options.port,
    rawBody: options.rawBody,
    stopActiveConnections: options.stopActiveConnections,
    tls: options.tls,
  }) as BunHttpApplicationAdapter;

  return runHttpAdapterApplication(rootModule, {
    ...options,
    shutdownRegistration: createNodeShutdownSignalRegistration(
      options.shutdownSignals ?? defaultNodeShutdownSignals(),
    ),
  }, adapter);
}

function requireBunGlobal(): BunGlobal {
  const bun = (globalThis as typeof globalThis & { Bun?: BunGlobal }).Bun;

  if (!bun || typeof bun.serve !== 'function') {
    throw new Error('Bun adapter requires globalThis.Bun.serve(). Run this package inside Bun or provide a Bun-compatible test double.');
  }

  return bun;
}

function resolvePort(port: number | undefined): number {
  return typeof port === 'number' && Number.isFinite(port) ? port : DEFAULT_PORT;
}

function createBunNativeRoutes(
  dispatcher: Dispatcher,
  handleRequest: BunRouteHandler,
  bun: BunGlobal,
): Record<string, BunRouteValue> | undefined {
  if (!supportsBunNativeRoutes(bun)) {
    return undefined;
  }

  const descriptors = dispatcher.describeRoutes?.();

  if (!descriptors || descriptors.length === 0) {
    return undefined;
  }

  const unsafeShapes = collectUnsafeNativeRouteShapes(descriptors);
  const routes = new Map<string, BunRouteMethodMap>();

  for (const descriptor of descriptors) {
    const method = toBunRouteMethod(descriptor.route.method);

    if (!method) {
      continue;
    }

    if (unsafeShapes.has(`${method}:${createBunRouteShapeKey(descriptor.route.path)}`)) {
      continue;
    }

    const routeHandlers = routes.get(descriptor.route.path) ?? {};
    routeHandlers[method] ??= handleRequest;
    routes.set(descriptor.route.path, routeHandlers);
  }

  return routes.size > 0 ? Object.fromEntries(routes) : undefined;
}

function supportsBunNativeRoutes(bun: BunGlobal): boolean {
  return compareBunVersions(bun.version, MINIMUM_BUN_NATIVE_ROUTES_VERSION) >= 0;
}

function compareBunVersions(left: string | undefined, right: string): number {
  if (typeof left !== 'string') {
    return -1;
  }

  const leftSegments = parseBunVersionSegments(left);
  const rightSegments = parseBunVersionSegments(right);
  const length = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftSegments[index] ?? 0;
    const rightValue = rightSegments[index] ?? 0;

    if (leftValue === rightValue) {
      continue;
    }

    return leftValue > rightValue ? 1 : -1;
  }

  return 0;
}

function parseBunVersionSegments(version: string): number[] {
  return version.match(/\d+/g)?.map((segment) => Number.parseInt(segment, 10)) ?? [];
}

function collectUnsafeNativeRouteShapes(descriptors: readonly HandlerDescriptor[]): Set<string> {
  const signatures = new Map<string, Set<string>>();
  const unsafe = new Set<string>();

  for (const descriptor of descriptors) {
    const shapeKey = createBunRouteShapeKey(descriptor.route.path);
    const paramSignature = descriptor.metadata.pathParams.join(',');

    if (descriptor.route.method === 'ALL') {
      for (const method of bunRouteMethods) {
        unsafe.add(`${method}:${shapeKey}`);
      }

      continue;
    }

    const key = `${descriptor.route.method}:${shapeKey}`;
    const current = signatures.get(key) ?? new Set<string>();
    current.add(paramSignature);
    signatures.set(key, current);

    if (current.size > 1) {
      unsafe.add(key);
    }
  }

  return unsafe;
}

function createBunRouteShapeKey(path: string): string {
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return '/';
  }

  return `/${segments.map((segment) => segment.startsWith(':') ? ':' : segment).join('/')}`;
}

function toBunRouteMethod(method: HttpMethod): BunRouteMethod | undefined {
  return method === 'ALL' ? undefined : method;
}

function closeBunServerWithDrain(
  server: BunServerLike,
  stopActiveConnections: boolean | undefined,
  waitForDrain: () => Promise<void>,
): Promise<void> {
  return (async () => {
    server.stop(stopActiveConnections);
    await waitForDrain();
  })();
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createShutdownResponse(): Response {
  return new Response(JSON.stringify({
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Server is shutting down.',
      status: 503,
    },
  }), {
    headers: {
      'content-type': 'application/json',
    },
    status: 503,
  });
}

function waitForCloseWithTimeout(closePromise: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`Bun adapter shutdown timeout exceeded ${String(timeoutMs)}ms.`));
    }, timeoutMs);

    void closePromise.then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

const bunRouteMethods: readonly BunRouteMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}
