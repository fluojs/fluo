import { createFetchStyleHttpAdapterRealtimeCapability, type Dispatcher, type HttpApplicationAdapter } from '@konekti/http';
import type { Application, ModuleType, MultipartOptions } from '@konekti/runtime';
import {
  bootstrapHttpAdapterApplication,
  runHttpAdapterApplication,
  type BootstrapHttpAdapterApplicationOptions,
  type HttpAdapterListenTarget,
  type RunHttpAdapterApplicationOptions,
} from '@konekti/runtime/internal/http-adapter';
import { dispatchWebRequest } from '@konekti/runtime/web';

export interface DenoServeOnListenInfo {
  hostname: string;
  port: number;
}

export interface DenoServeOptions {
  hostname?: string;
  onListen?: (localAddr: DenoServeOnListenInfo) => void;
  port?: number;
  signal?: AbortSignal;
}

export interface DenoServeController {
  finished: Promise<void>;
  shutdown(): Promise<void> | void;
}

export type DenoWebSocketMessage = Blob | string;

export interface DenoServerWebSocket extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
}

export interface DenoWebSocketUpgradeResult<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  response: Response;
  socket: TSocket;
}

export type DenoUpgradeWebSocketFunction<TSocket extends DenoServerWebSocket = DenoServerWebSocket> = (
  request: Request,
) => DenoWebSocketUpgradeResult<TSocket>;

export interface DenoWebSocketUpgradeHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  upgrade(request: Request): DenoWebSocketUpgradeResult<TSocket>;
}

export interface DenoWebSocketBinding<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  fetch(request: Request, host: DenoWebSocketUpgradeHost<TSocket>): Response | Promise<Response>;
}

export interface DenoWebSocketBindingHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  configureWebSocketBinding(binding: DenoWebSocketBinding<TSocket> | undefined): void;
}

export type DenoServeHandler = (request: Request) => Response | Promise<Response>;
export type DenoServeFunction = (
  options: DenoServeOptions,
  handler: DenoServeHandler,
) => DenoServeController;

type DenoGlobalLike = {
  serve: DenoServeFunction;
  upgradeWebSocket: DenoUpgradeWebSocketFunction;
};

export interface DenoAdapterOptions {
  hostname?: string;
  maxBodySize?: number;
  multipart?: MultipartOptions;
  onListen?: (localAddr: DenoServeOnListenInfo) => void;
  port?: number;
  rawBody?: boolean;
  serve?: DenoServeFunction;
  upgradeWebSocket?: DenoUpgradeWebSocketFunction;
}

export interface BootstrapDenoApplicationOptions extends BootstrapHttpAdapterApplicationOptions, DenoAdapterOptions {
}

export interface RunDenoApplicationOptions extends RunHttpAdapterApplicationOptions, DenoAdapterOptions {
}

const DEFAULT_HOSTNAME = '0.0.0.0';
const DEFAULT_PORT = 3000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

declare global {
  interface GlobalThis {
    Deno?: DenoGlobalLike;
  }
}

export class DenoHttpApplicationAdapter implements HttpApplicationAdapter {
  private abortController?: AbortController;
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private inFlightDrain?: Deferred<void>;
  private inFlightRequestCount = 0;
  private server?: DenoServeController;
  private websocketBinding?: DenoWebSocketBinding<DenoServerWebSocket>;

  constructor(private readonly options: Required<Pick<DenoAdapterOptions, 'hostname' | 'port'>> & DenoAdapterOptions) {}

  getServer(): DenoServeController | undefined {
    return this.server;
  }

  getListenTarget(): HttpAdapterListenTarget {
    return createListenTarget(this.options.hostname, this.options.port);
  }

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @konekti/websockets/deno for the official raw websocket binding.',
      { support: 'supported' },
    );
  }

  configureWebSocketBinding<TSocket extends DenoServerWebSocket>(
    binding: DenoWebSocketBinding<TSocket> | undefined,
  ): void {
    if (this.server) {
      throw new Error('Deno websocket binding must be configured before Deno adapter listen() starts the server.');
    }

    this.websocketBinding = binding;
  }

  async handle(request: Request): Promise<Response> {
    if (this.closeInFlight) {
      return createShutdownResponse();
    }

    const release = this.trackInFlightRequest();

    try {
      if (this.websocketBinding && isWebSocketUpgradeRequest(request)) {
        const upgradeWebSocket = resolveUpgradeWebSocket(this.options.upgradeWebSocket);

        return await this.websocketBinding.fetch(request, {
          upgrade: (upgradeRequest) => upgradeWebSocket(upgradeRequest),
        });
      }

      return await dispatchWebRequest({
        dispatcher: this.dispatcher,
        dispatcherNotReadyMessage: 'Deno adapter received a request before dispatcher binding completed.',
        maxBodySize: this.options.maxBodySize,
        multipart: this.options.multipart,
        rawBody: this.options.rawBody,
        request,
      });
    } finally {
      release();
    }
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;

    if (this.server) {
      return;
    }

    const abortController = new AbortController();
    const serve = resolveServe(this.options.serve);

    this.abortController = abortController;
    this.server = serve({
      hostname: this.options.hostname,
      onListen: this.options.onListen,
      port: this.options.port,
      signal: abortController.signal,
    }, async (request) => {
      return await this.handle(request);
    });
  }

  async close(): Promise<void> {
    if (this.closeInFlight) {
      await waitForCloseWithTimeout(this.closeInFlight, DEFAULT_SHUTDOWN_TIMEOUT_MS);
      return;
    }

    const server = this.server;
    const abortController = this.abortController;

    if (!server) {
      this.dispatcher = undefined;
      this.abortController = undefined;
      return;
    }

    const closePromise = closeDenoServerWithDrain(
      server,
      abortController,
      () => this.waitForInFlightRequests(),
    );
    const closeInFlight = closePromise.finally(() => {
      if (this.server === server) {
        this.server = undefined;
      }

      if (this.abortController === abortController) {
        this.abortController = undefined;
      }

      this.closeInFlight = undefined;
      this.dispatcher = undefined;
    });

    this.closeInFlight = closeInFlight;
    void closeInFlight.catch(() => {});

    await waitForCloseWithTimeout(closeInFlight, DEFAULT_SHUTDOWN_TIMEOUT_MS);
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

export function createDenoAdapter(options: DenoAdapterOptions = {}): DenoHttpApplicationAdapter {
  return new DenoHttpApplicationAdapter({
    ...options,
    hostname: options.hostname ?? DEFAULT_HOSTNAME,
    port: options.port ?? DEFAULT_PORT,
  });
}

export async function bootstrapDenoApplication(
  rootModule: ModuleType,
  options: BootstrapDenoApplicationOptions = {},
): Promise<Application> {
  return await bootstrapHttpAdapterApplication(rootModule, options, createDenoAdapter(options));
}

export async function runDenoApplication(
  rootModule: ModuleType,
  options: RunDenoApplicationOptions = {},
): Promise<Application> {
  const adapter = createDenoAdapter(options);
  return await runHttpAdapterApplication(rootModule, options, adapter);
}

function createListenTarget(hostname: string, port: number): HttpAdapterListenTarget {
  const isWildcard = hostname === '0.0.0.0' || hostname === '::';
  const bindTarget = `${hostname}:${String(port)}`;
  const publicHostname = isWildcard ? 'localhost' : hostname;

  return {
    bindTarget,
    url: `http://${publicHostname}:${String(port)}`,
  };
}

function resolveServe(serve: DenoServeFunction | undefined): DenoServeFunction {
  if (serve) {
    return serve;
  }

  const denoGlobal = (globalThis as typeof globalThis & { Deno?: DenoGlobalLike }).Deno;

  if (denoGlobal?.serve) {
    return denoGlobal.serve.bind(denoGlobal);
  }

  throw new Error('Deno.serve is not available. Pass options.serve when running outside Deno.');
}

function resolveUpgradeWebSocket(
  upgradeWebSocket: DenoUpgradeWebSocketFunction | undefined,
): DenoUpgradeWebSocketFunction {
  if (upgradeWebSocket) {
    return upgradeWebSocket;
  }

  const denoGlobal = (globalThis as typeof globalThis & { Deno?: DenoGlobalLike }).Deno;

  if (denoGlobal?.upgradeWebSocket) {
    return denoGlobal.upgradeWebSocket.bind(denoGlobal);
  }

  throw new Error('Deno.upgradeWebSocket is not available. Pass options.upgradeWebSocket when running outside Deno.');
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function closeDenoServerWithDrain(
  server: DenoServeController,
  abortController: AbortController | undefined,
  waitForDrain: () => Promise<void>,
): Promise<void> {
  return (async () => {
    abortController?.abort();
    await server.shutdown();
    await waitForDrain();
    await server.finished;
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
  return Promise.race([
    closePromise,
    new Promise<void>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`Deno adapter shutdown timeout exceeded ${String(timeoutMs)}ms.`));
      }, timeoutMs);
    }),
  ]);
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}
