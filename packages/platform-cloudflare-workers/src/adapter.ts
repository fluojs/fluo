import {
  createFetchStyleHttpAdapterRealtimeCapability,
} from '@fluojs/http/internal';
import {
  bootstrapHttpAdapterApplication,
} from '@fluojs/runtime/internal/http-adapter';
import type {
  CorsOptions,
  Dispatcher,
  HttpApplicationAdapter,
  MiddlewareLike,
  SecurityHeadersOptions,
} from '@fluojs/http';
import type {
  Application,
  CreateApplicationOptions,
  ModuleType,
} from '@fluojs/runtime';
import {
  createWebRequestResponseFactory,
  dispatchWebRequest,
  type CreateWebRequestResponseFactoryOptions,
  type DispatchWebRequestOptions,
} from '@fluojs/runtime/web';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    cloudflare?: CloudflareWorkerRequestContext;
  }
}

const WORKER_DISPATCHER_NOT_READY_MESSAGE =
  'Cloudflare Workers adapter received a request before dispatcher binding completed.';
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const WEBSOCKET_CLOSED_READY_STATE = 3;
const ADAPTER_CLOSE_SETTLED = Symbol('CloudflareWorkerAdapterCloseSettled');
const WEBSOCKET_BINDING_RECONFIGURATION_MESSAGE =
  'Cloudflare Workers websocket binding must be configured before listen() starts accepting Worker requests.';
type CloudflareWorkerCorsInput = false | string | string[] | CorsOptions;
type WebRequestResponseFactory = NonNullable<DispatchWebRequestOptions['factory']>;

interface CloudflareWorkerMiddlewareOptions {
  cors?: CloudflareWorkerCorsInput;
  globalPrefix?: string;
  globalPrefixExclude?: readonly string[];
  middleware?: MiddlewareLike[];
  securityHeaders?: false | SecurityHeadersOptions;
}

/** Minimal Worker execution context surface used by the adapter. */
export interface CloudflareWorkerExecutionContext {
  passThroughOnException?(): void;
  waitUntil(promise: Promise<unknown>): void;
}

/** Worker-specific request context attached to fluo HTTP requests by the Cloudflare adapter. */
export interface CloudflareWorkerRequestContext<Env = unknown> {
  readonly env: Env;
  readonly executionContext?: CloudflareWorkerExecutionContext;
}

/** Message payloads accepted by Cloudflare Worker websockets. */
export type CloudflareWorkerWebSocketMessage = ArrayBuffer | ArrayBufferView | Blob | string;

/** Server-side Cloudflare Worker websocket shape used by the raw binding seam. */
export interface CloudflareWorkerWebSocket
  extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
  accept(): void;
}

/** Pair returned by Cloudflare's `WebSocketPair` constructor. */
export interface CloudflareWorkerWebSocketPair {
  0: CloudflareWorkerWebSocket;
  1: CloudflareWorkerWebSocket;
}

/** Factory for creating Cloudflare Worker websocket pairs during upgrades. */
export type CloudflareWorkerWebSocketPairFactory = () => CloudflareWorkerWebSocketPair;

/** Result returned when the adapter upgrades a request to a Worker websocket. */
export interface CloudflareWorkerWebSocketUpgradeResult {
  response: Response;
  serverSocket: CloudflareWorkerWebSocket;
}

/** Host wrapper passed to websocket bindings for performing Worker upgrades. */
export interface CloudflareWorkerWebSocketUpgradeHost {
  upgrade(request: Request): CloudflareWorkerWebSocketUpgradeResult;
}

/** Official websocket binding contract consumed by `@fluojs/websockets/cloudflare-workers`. */
export interface CloudflareWorkerWebSocketBinding {
  fetch(request: Request, host: CloudflareWorkerWebSocketUpgradeHost): Response | Promise<Response>;
}

/** Hook surface exposed by the Worker adapter for websocket bindings. */
export interface CloudflareWorkerWebSocketBindingHost {
  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void;
}

/** Parsing and transport options for the Cloudflare Worker adapter. */
export interface CloudflareWorkerAdapterOptions extends CreateWebRequestResponseFactoryOptions {
  createWebSocketPair?: CloudflareWorkerWebSocketPairFactory;
}

/** Bootstrap options for constructing a Cloudflare Worker application shell. */
export interface BootstrapCloudflareWorkerApplicationOptions
  extends Omit<CreateApplicationOptions, 'adapter' | 'middleware'>,
    CloudflareWorkerMiddlewareOptions,
    CloudflareWorkerAdapterOptions {}

/** Fetch handler shape exposed by Worker-backed application entrypoints. */
export interface CloudflareWorkerHandler<Env = unknown> {
  fetch(
    request: Request,
    env: Env,
    executionContext: CloudflareWorkerExecutionContext,
  ): Promise<Response>;
}

/** Fully bootstrapped Cloudflare Worker application wrapper. */
export interface CloudflareWorkerApplication<Env = unknown>
  extends CloudflareWorkerHandler<Env> {
  readonly adapter: CloudflareWorkerHttpApplicationAdapter;
  readonly app: Application;

  close(signal?: string): Promise<void>;
}

/** Lazy Cloudflare Worker entrypoint that bootstraps on first use. */
export interface CloudflareWorkerEntrypoint<Env = unknown>
  extends CloudflareWorkerHandler<Env> {
  close(signal?: string): Promise<void>;
  ready(): Promise<CloudflareWorkerApplication<Env>>;
}

/**
 * Cloudflare Workers HTTP adapter with waitUntil-aware request tracking and graceful close behavior.
 */
export class CloudflareWorkerHttpApplicationAdapter
  implements HttpApplicationAdapter, CloudflareWorkerWebSocketBindingHost {
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private inFlightDrain?: Deferred<void>;
  private inFlightRequestCount = 0;
  private isClosed = false;
  private isWebSocketBindingFrozen = false;
  private websocketBinding?: CloudflareWorkerWebSocketBinding;
  private readonly options: CloudflareWorkerAdapterOptions;
  private readonly webRequestResponseFactory;

  constructor(options: CloudflareWorkerAdapterOptions = {}) {
    validateNonNegativeIntegerOption('maxBodySize', options.maxBodySize);
    this.options = options;
    this.webRequestResponseFactory = createWebRequestResponseFactory(options);
  }

  async close(): Promise<void> {
    if (this.closeInFlight) {
      await waitForCloseWithTimeout(this.closeInFlight, DEFAULT_SHUTDOWN_TIMEOUT_MS);
      return;
    }

    if (!this.dispatcher) {
      this.isClosed = true;
      return;
    }

    this.isClosed = true;

    const closeInFlight = this.waitForInFlightRequests().finally(() => {
      this.closeInFlight = undefined;
      this.dispatcher = undefined;
    });

    this.closeInFlight = closeInFlight;
    void closeInFlight.catch(() => {});

    await waitForCloseWithTimeout(closeInFlight, DEFAULT_SHUTDOWN_TIMEOUT_MS);
  }

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @fluojs/websockets/cloudflare-workers for the official raw websocket binding.',
      { support: 'supported' },
    );
  }

  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void {
    if (this.isWebSocketBindingFrozen && binding !== this.websocketBinding) {
      throw new Error(WEBSOCKET_BINDING_RECONFIGURATION_MESSAGE);
    }

    this.websocketBinding = binding;
  }

  [ADAPTER_CLOSE_SETTLED](): Promise<void> {
    return this.closeInFlight ?? Promise.resolve();
  }

  async fetch<Env = unknown>(
    request: Request,
    env?: Env,
    executionContext?: CloudflareWorkerExecutionContext,
  ): Promise<Response> {
    if (this.closeInFlight || this.isClosed) {
      return createShutdownResponse();
    }

    const release = this.trackInFlightRequest();
    const dispatcher = this.dispatcher;

    if (dispatcher && this.websocketBinding && isWebSocketUpgradeRequest(request)) {
      const socketLifecycles: Promise<void>[] = [];

      try {
        const response = await this.websocketBinding.fetch(request, {
          upgrade: (upgradeRequest) => {
            const upgrade = this.upgradeWebSocket(upgradeRequest);
            socketLifecycles.push(createWebSocketCloseLifecycle(upgrade.serverSocket));
            return upgrade;
          },
        });

        return response;
      } finally {
        const lifecycle = Promise.all(socketLifecycles)
          .then(() => undefined)
          .finally(release);
        executionContext?.waitUntil(lifecycle);
      }
    }

    const responsePromise = (async () => {
      return await dispatchWebRequest({
        dispatcher,
        dispatcherNotReadyMessage: WORKER_DISPATCHER_NOT_READY_MESSAGE,
        factory: this.createRequestResponseFactory(env, executionContext),
        request,
      });
    })();

    const trackedResponsePromise = responsePromise.then(
      (response) => createLifecycleTrackedResponse(response, release),
      (error: unknown) => {
        release();
        throw error;
      },
    );

    executionContext?.waitUntil(
      trackedResponsePromise
        .then(({ lifecycle }) => lifecycle)
        .then(() => undefined, () => undefined),
    );

    return (await trackedResponsePromise).response;
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    if (this.closeInFlight) {
      throw new Error('Cloudflare Workers adapter cannot listen while shutdown is still draining.');
    }

    this.isClosed = false;
    this.isWebSocketBindingFrozen = true;
    this.dispatcher = dispatcher;
  }

  private upgradeWebSocket(_request: Request): CloudflareWorkerWebSocketUpgradeResult {
    const pair = resolveWebSocketPairFactory(this.options.createWebSocketPair)();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    return {
      response: createWebSocketUpgradeResponse(clientSocket),
      serverSocket,
    };
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

  private createRequestResponseFactory<Env>(
    env: Env | undefined,
    executionContext: CloudflareWorkerExecutionContext | undefined,
  ): WebRequestResponseFactory {
    const baseFactory = this.webRequestResponseFactory;

    return {
      ...baseFactory,
      async createRequest(request, signal) {
        const frameworkRequest = await baseFactory.createRequest(request, signal);
        frameworkRequest.cloudflare = { env, executionContext };
        return frameworkRequest;
      },
    };
  }
}

/**
 * Create the canonical Cloudflare Worker adapter instance.
 *
 * @param options Parsing, raw-body, and websocket-pair options for Worker requests.
 * @returns A Cloudflare Worker HTTP adapter.
 */
export function createCloudflareWorkerAdapter(
  options: CloudflareWorkerAdapterOptions = {},
): CloudflareWorkerHttpApplicationAdapter {
  return new CloudflareWorkerHttpApplicationAdapter(options);
}

/**
 * Bootstrap a Cloudflare Worker application and return its fetch-capable wrapper.
 *
 * @param rootModule Root module compiled by the Fluo runtime.
 * @param options Worker adapter and runtime bootstrap options.
 * @returns A bootstrapped Worker application wrapper with `fetch(...)` and `close(...)`.
 */
export async function bootstrapCloudflareWorkerApplication<Env = unknown>(
  rootModule: ModuleType,
  options: BootstrapCloudflareWorkerApplicationOptions = {},
): Promise<CloudflareWorkerApplication<Env>> {
  const adapter = createCloudflareWorkerAdapter(options);
  const app = await bootstrapHttpAdapterApplication(rootModule, options, adapter);
  await app.listen();

  return {
    adapter,
    app,
    close(signal?: string) {
      return app.close(signal);
    },
    fetch(request: Request, env: Env, executionContext: CloudflareWorkerExecutionContext) {
      return adapter.fetch(request, env, executionContext);
    },
  };
}

/**
 * Create a lazy Cloudflare Worker entrypoint that bootstraps once on first request.
 *
 * @param rootModule Root module compiled by the Fluo runtime.
 * @param options Worker adapter and runtime bootstrap options.
 * @returns A Worker entrypoint exposing lazy `fetch(...)`, `ready()`, and `close(...)` helpers.
 */
export function createCloudflareWorkerEntrypoint<Env = unknown>(
  rootModule: ModuleType,
  options: BootstrapCloudflareWorkerApplicationOptions = {},
): CloudflareWorkerEntrypoint<Env> {
  let closeError: unknown;
  let closeInFlight: Promise<void> | undefined;
  let closeRecovery: Promise<void> | undefined;
  let runningApplication: Promise<CloudflareWorkerApplication<Env>> | undefined;

  const ready = async (): Promise<CloudflareWorkerApplication<Env>> => {
    if (closeRecovery) {
      await closeRecovery;
    }

    if (closeError) {
      throw closeError;
    }

    if (!runningApplication) {
      runningApplication = bootstrapCloudflareWorkerApplication<Env>(rootModule, options);
    }

    return await runningApplication;
  };

  return {
    async close(signal?: string) {
      if (closeInFlight) {
        await closeInFlight;
        return;
      }

      if (closeRecovery) {
        await closeRecovery;
      }

      if (closeError) {
        throw closeError;
      }

      const application = runningApplication;

      if (!application) {
        return;
      }

      const closing = (async () => {
        let currentApplication: CloudflareWorkerApplication<Env> | undefined;

        try {
          currentApplication = await application;
          await currentApplication.close(signal);

          if (runningApplication === application) {
            runningApplication = undefined;
          }
        } catch (error) {
          if (currentApplication && isShutdownTimeoutError(error)) {
            closeRecovery = watchTimedOutCloseRecovery(currentApplication, {
              clearRunningApplication() {
                if (runningApplication === application) {
                  runningApplication = undefined;
                }
              },
              setCloseError(error) {
                closeError = error;
              },
              setCloseRecovery(recovery) {
                closeRecovery = recovery;
              },
            });
          } else {
            closeError = error;
          }

          throw error;
        } finally {
          closeInFlight = undefined;
        }
      })();

      closeInFlight = closing;
      await closing;
    },
    async fetch(request: Request, env: Env, executionContext: CloudflareWorkerExecutionContext) {
      if (closeError || closeInFlight || closeRecovery) {
        return createShutdownResponse();
      }

      return await (await ready()).fetch(request, env, executionContext);
    },
    ready,
  };
}

function createWebSocketUpgradeResponse(socket: CloudflareWorkerWebSocket): Response {
  try {
    return new Response(null, {
      status: 101,
      webSocket: socket,
    });
  } catch {
    const response = Object.create(Response.prototype) as Response & { webSocket?: CloudflareWorkerWebSocket };

    Object.defineProperties(response, {
      headers: { value: new Headers() },
      ok: { value: false },
      redirected: { value: false },
      status: { value: 101 },
      statusText: { value: 'Switching Protocols' },
      type: { value: 'default' },
      url: { value: '' },
      webSocket: { value: socket },
    });

    return response;
  }
}

function resolveWebSocketPairFactory(
  createWebSocketPair: CloudflareWorkerWebSocketPairFactory | undefined,
): CloudflareWorkerWebSocketPairFactory {
  if (createWebSocketPair) {
    return createWebSocketPair;
  }

  const pair = (globalThis as typeof globalThis & {
    WebSocketPair?: new () => CloudflareWorkerWebSocketPair;
  }).WebSocketPair;

  if (typeof pair === 'function') {
    return () => new pair();
  }

  throw new Error('Cloudflare Workers websocket support requires globalThis.WebSocketPair or options.createWebSocketPair().');
}

function validateNonNegativeIntegerOption(name: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} value: ${String(value)}. Expected a non-negative integer.`);
  }
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function createWebSocketCloseLifecycle(socket: CloudflareWorkerWebSocket): Promise<void> {
  if (socket.readyState === WEBSOCKET_CLOSED_READY_STATE) {
    return Promise.resolve();
  }

  const lifecycle = createDeferred<void>();
  socket.addEventListener('close', () => lifecycle.resolve(), { once: true });

  if (socket.readyState === WEBSOCKET_CLOSED_READY_STATE) {
    lifecycle.resolve();
  }

  return lifecycle.promise;
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

function watchTimedOutCloseRecovery<Env>(
  currentApplication: CloudflareWorkerApplication<Env>,
  callbacks: {
    clearRunningApplication(): void;
    setCloseError(error: unknown): void;
    setCloseRecovery(recovery: Promise<void> | undefined): void;
  },
): Promise<void> {
  const recovery = currentApplication.adapter[ADAPTER_CLOSE_SETTLED]().then(
    () => {
      callbacks.clearRunningApplication();
    },
    (error: unknown) => {
      callbacks.setCloseError(error);
      throw error;
    },
  );
  const recoveryWithCleanup = recovery.finally(() => {
    callbacks.setCloseRecovery(undefined);
  });

  void recoveryWithCleanup.catch(() => undefined);

  return recoveryWithCleanup;
}

function createShutdownTimeoutMessage(timeoutMs: number): string {
  return `Cloudflare Workers adapter shutdown timeout exceeded ${String(timeoutMs)}ms.`;
}

function isShutdownTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === createShutdownTimeoutMessage(DEFAULT_SHUTDOWN_TIMEOUT_MS);
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

function createLifecycleTrackedResponse(
  response: Response,
  release: () => void,
): { lifecycle: Promise<void>; response: Response } {
  if (!isLifecycleTrackedStreamingResponse(response)) {
    release();
    return { lifecycle: Promise.resolve(), response };
  }

  const lifecycle = createDeferred<void>();
  const responseBody = response.body;

  if (!responseBody) {
    release();
    return { lifecycle: Promise.resolve(), response };
  }

  try {
    const reader = responseBody.getReader();
    const trackedBody = new ReadableStream<Uint8Array>({
      async cancel(reason) {
        try {
          await reader.cancel(reason);
          lifecycle.resolve();
        } catch (error) {
          lifecycle.reject(error);
          throw error;
        }
      },
      async pull(controller) {
        try {
          const result = await reader.read();

          if (result.done) {
            controller.close();
            lifecycle.resolve();
            return;
          }

          controller.enqueue(result.value);
        } catch (error) {
          controller.error(error);
          lifecycle.reject(error);
        }
      },
    });

    return {
      lifecycle: lifecycle.promise.finally(release),
      response: new Response(trackedBody, response),
    };
  } catch (error) {
    release();
    throw error;
  }
}

function isLifecycleTrackedStreamingResponse(response: Response): boolean {
  return response.body !== null
    && response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') === true;
}

function waitForCloseWithTimeout(closePromise: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(createShutdownTimeoutMessage(timeoutMs)));
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

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

declare global {
  interface ResponseInit {
    webSocket?: CloudflareWorkerWebSocket;
  }

  interface GlobalThis {
    WebSocketPair?: new () => CloudflareWorkerWebSocketPair;
  }
}
