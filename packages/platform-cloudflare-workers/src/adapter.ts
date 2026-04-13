import {
  createFetchStyleHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import {
  bootstrapHttpAdapterApplication,
  type BootstrapHttpAdapterApplicationOptions,
} from '@fluojs/runtime/internal/http-adapter';
import type {
  Application,
  ModuleType,
  UploadedFile,
} from '@fluojs/runtime';
import {
  dispatchWebRequest,
  type CreateWebRequestResponseFactoryOptions,
} from '@fluojs/runtime/web';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

const WORKER_DISPATCHER_NOT_READY_MESSAGE =
  'Cloudflare Workers adapter received a request before dispatcher binding completed.';

/** Minimal Worker execution context surface used by the adapter. */
export interface CloudflareWorkerExecutionContext {
  passThroughOnException?(): void;
  waitUntil(promise: Promise<unknown>): void;
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
  extends BootstrapHttpAdapterApplicationOptions,
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
  private websocketBinding?: CloudflareWorkerWebSocketBinding;

  constructor(private readonly options: CloudflareWorkerAdapterOptions = {}) {}

  async close(): Promise<void> {
    if (this.closeInFlight) {
      await this.closeInFlight;
      return;
    }

    if (!this.dispatcher) {
      return;
    }

    const closeInFlight = this.waitForInFlightRequests().finally(() => {
      this.closeInFlight = undefined;
      this.dispatcher = undefined;
    });

    this.closeInFlight = closeInFlight;
    void closeInFlight.catch(() => {});

    await closeInFlight;
  }

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @fluojs/websockets/cloudflare-workers for the official raw websocket binding.',
      { support: 'supported' },
    );
  }

  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void {
    this.websocketBinding = binding;
  }

  async fetch<Env = unknown>(
    request: Request,
    _env?: Env,
    executionContext?: CloudflareWorkerExecutionContext,
  ): Promise<Response> {
    if (this.closeInFlight) {
      return createShutdownResponse();
    }

    const release = this.trackInFlightRequest();
    const responsePromise = (async () => {
      try {
        if (this.websocketBinding && isWebSocketUpgradeRequest(request)) {
          return await this.websocketBinding.fetch(request, {
            upgrade: (upgradeRequest) => this.upgradeWebSocket(upgradeRequest),
          });
        }

        return await dispatchWebRequest({
          ...this.options,
          dispatcher: this.dispatcher,
          dispatcherNotReadyMessage: WORKER_DISPATCHER_NOT_READY_MESSAGE,
          request,
        });
      } finally {
        release();
      }
    })();

    executionContext?.waitUntil(responsePromise.then(() => undefined, () => undefined));

    return await responsePromise;
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
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
  let runningApplication: Promise<CloudflareWorkerApplication<Env>> | undefined;

  const ready = async (): Promise<CloudflareWorkerApplication<Env>> => {
    if (!runningApplication) {
      runningApplication = bootstrapCloudflareWorkerApplication<Env>(rootModule, options);
    }

    return await runningApplication;
  };

  return {
    async close(signal?: string) {
      const application = runningApplication;
      runningApplication = undefined;

      if (!application) {
        return;
      }

      await (await application).close(signal);
    },
    async fetch(request: Request, env: Env, executionContext: CloudflareWorkerExecutionContext) {
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

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
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
