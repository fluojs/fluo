import { createFetchStyleHttpAdapterRealtimeCapability, type Dispatcher, type HttpApplicationAdapter } from '@fluojs/http';
import type { Application, ApplicationLogger, ModuleType, MultipartOptions } from '@fluojs/runtime';
import {
  bootstrapHttpAdapterApplication,
  runHttpAdapterApplication,
  type BootstrapHttpAdapterApplicationOptions,
  type HttpAdapterListenTarget,
  type RunHttpAdapterApplicationOptions,
} from '@fluojs/runtime/internal/http-adapter';
import { createWebRequestResponseFactory, dispatchWebRequest } from '@fluojs/runtime/web';

/** Listen target metadata reported by `Deno.serve(...)` callbacks. */
export interface DenoServeOnListenInfo {
  hostname: string;
  port: number;
}

/** Options forwarded to the Deno-native `serve(...)` implementation. */
export interface DenoServeOptions {
  cert?: string;
  hostname?: string;
  key?: string;
  onListen?: (localAddr: DenoServeOnListenInfo) => void;
  port?: number;
  signal?: AbortSignal;
}

/** Minimal controller contract returned by `Deno.serve(...)`. */
export interface DenoServeController {
  finished: Promise<void>;
  shutdown(): Promise<void> | void;
}

/** Deno shutdown signals supported by `runDenoApplication(...)`. */
export type DenoApplicationSignal = 'SIGINT' | 'SIGTERM';

/** Message payloads delivered through Deno server websocket bindings. */
export type DenoWebSocketMessage = Blob | string;

/** Server-side websocket shape used by the Deno platform binding seam. */
export interface DenoServerWebSocket extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
}

/** Result returned when the Deno runtime upgrades a request to websocket mode. */
export interface DenoWebSocketUpgradeResult<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  response: Response;
  socket: TSocket;
}

/** Function signature for `Deno.upgradeWebSocket(...)` style adapters. */
export type DenoUpgradeWebSocketFunction<TSocket extends DenoServerWebSocket = DenoServerWebSocket> = (
  request: Request,
) => DenoWebSocketUpgradeResult<TSocket>;

/** Host wrapper that exposes websocket upgrade support to binding integrations. */
export interface DenoWebSocketUpgradeHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  upgrade(request: Request): DenoWebSocketUpgradeResult<TSocket>;
}

/** Official Deno websocket binding contract consumed by `@fluojs/websockets/deno`. */
export interface DenoWebSocketBinding<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  fetch(request: Request, host: DenoWebSocketUpgradeHost<TSocket>): Response | Promise<Response>;
}

/** Hook surface exposed by the Deno HTTP adapter for websocket bindings. */
export interface DenoWebSocketBindingHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  configureWebSocketBinding(binding: DenoWebSocketBinding<TSocket> | undefined): void;
}

/** Native request handler shape accepted by Deno's HTTP server runtime. */
export type DenoServeHandler = (request: Request) => Response | Promise<Response>;
/** Function signature for a pluggable Deno serve implementation. */
export type DenoServeFunction = (
  options: DenoServeOptions,
  handler: DenoServeHandler,
) => DenoServeController;

type DenoGlobalLike = {
  addSignalListener?: (signal: DenoApplicationSignal, handler: () => void) => void;
  removeSignalListener?: (signal: DenoApplicationSignal, handler: () => void) => void;
  serve: DenoServeFunction;
  upgradeWebSocket: DenoUpgradeWebSocketFunction;
};

/** TLS certificate and private key material forwarded to Deno.serve for HTTPS startup. */
export interface DenoAdapterHttpsOptions {
  cert: string;
  key: string;
}

/** Transport and parsing options for the Deno HTTP adapter factory. */
export interface DenoAdapterOptions {
  host?: string;
  hostname?: string;
  https?: DenoAdapterHttpsOptions;
  maxBodySize?: number;
  multipart?: MultipartOptions;
  onListen?: (localAddr: DenoServeOnListenInfo) => void;
  port?: number;
  rawBody?: boolean;
  serve?: DenoServeFunction;
  upgradeWebSocket?: DenoUpgradeWebSocketFunction;
}

/** Bootstrap options for creating a Deno-backed app without auto-running it. */
export interface BootstrapDenoApplicationOptions extends BootstrapHttpAdapterApplicationOptions, DenoAdapterOptions {
}

/** Run-helper options for Deno apps, including optional signal wiring. */
export interface RunDenoApplicationOptions extends RunHttpAdapterApplicationOptions, DenoAdapterOptions {
  shutdownSignals?: false | readonly DenoApplicationSignal[];
}

const DEFAULT_HOSTNAME = '0.0.0.0';
const DEFAULT_PORT = 3000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

declare global {
  interface GlobalThis {
    Deno?: DenoGlobalLike;
  }
}

/**
 * Deno-backed HTTP adapter that preserves request draining and websocket binding seams.
 */
export class DenoHttpApplicationAdapter implements HttpApplicationAdapter {
  private abortController?: AbortController;
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
  private inFlightDrain?: Deferred<void>;
  private inFlightRequestCount = 0;
  private server?: DenoServeController;
  private websocketBinding?: DenoWebSocketBinding<DenoServerWebSocket>;
  private readonly options: Required<Pick<DenoAdapterOptions, 'hostname' | 'port'>> & DenoAdapterOptions;
  private readonly webRequestResponseFactory;

  constructor(options: Required<Pick<DenoAdapterOptions, 'hostname' | 'port'>> & DenoAdapterOptions) {
    this.options = options;
    this.webRequestResponseFactory = createWebRequestResponseFactory({
      maxBodySize: options.maxBodySize,
      multipart: options.multipart,
      rawBody: options.rawBody,
    });
  }

  getServer(): DenoServeController | undefined {
    return this.server;
  }

  getListenTarget(): HttpAdapterListenTarget {
    return createListenTarget(this.options.hostname, this.options.port, this.options.https !== undefined);
  }

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @fluojs/websockets/deno for the official raw websocket binding.',
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
        factory: this.webRequestResponseFactory,
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
      cert: this.options.https?.cert,
      hostname: this.options.hostname,
      key: this.options.https?.key,
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

/**
 * Create the canonical Deno HTTP adapter instance.
 *
 * @param options Transport, parsing, and websocket-host configuration for the Deno runtime.
 * @returns A Deno-backed `HttpApplicationAdapter`.
 */
export function createDenoAdapter(options: DenoAdapterOptions = {}): DenoHttpApplicationAdapter {
  return new DenoHttpApplicationAdapter({
    ...options,
    hostname: options.hostname ?? options.host ?? DEFAULT_HOSTNAME,
    port: options.port ?? DEFAULT_PORT,
  });
}

/**
 * Bootstrap a Deno-backed application shell without the quick-start run helper.
 *
 * @param rootModule Root module compiled by the Fluo runtime.
 * @param options Bootstrap-time Deno adapter and runtime options.
 * @returns An initialized application shell that can be listened to later.
 */
export async function bootstrapDenoApplication(
  rootModule: ModuleType,
  options: BootstrapDenoApplicationOptions = {},
): Promise<Application> {
  return await bootstrapHttpAdapterApplication(rootModule, options, createDenoAdapter(options));
}

/**
 * Bootstrap and run a Deno-backed application with optional shutdown signal wiring.
 *
 * @param rootModule Root module compiled by the Fluo runtime.
 * @param options Runtime, adapter, and signal-registration options for Deno.
 * @returns A running application shell ready to receive requests.
 */
export async function runDenoApplication(
  rootModule: ModuleType,
  options: RunDenoApplicationOptions = {},
): Promise<Application> {
  const adapter = createDenoAdapter(options);
  return await runHttpAdapterApplication(rootModule, {
    ...options,
    shutdownRegistration: options.shutdownSignals === false
      ? undefined
      : createDenoShutdownSignalRegistration(options.shutdownSignals ?? defaultDenoShutdownSignals()),
  }, adapter);
}

function defaultDenoShutdownSignals(): readonly DenoApplicationSignal[] {
  return ['SIGINT', 'SIGTERM'];
}

function createDenoShutdownSignalRegistration(
  signals: readonly DenoApplicationSignal[],
): NonNullable<RunHttpAdapterApplicationOptions['shutdownRegistration']> {
  return (app: Application, logger: ApplicationLogger) => {
    const denoGlobal = resolveDenoSignalGlobal();

    if (!denoGlobal) {
      return () => {};
    }

    const bindings: Array<{ handler: () => void; signal: DenoApplicationSignal }> = [];
    const seen = new Set<DenoApplicationSignal>();

    for (const signal of signals) {
      if (seen.has(signal)) {
        continue;
      }

      seen.add(signal);
      const handler = () => {
        void closeDenoApplicationFromSignal(app, logger, signal);
      };

      bindings.push({ handler, signal });
      denoGlobal.addSignalListener(signal, handler);
    }

    return () => {
      for (const binding of bindings) {
        denoGlobal.removeSignalListener(binding.signal, binding.handler);
      }
    };
  };
}

function createListenTarget(hostname: string, port: number, usesHttps: boolean): HttpAdapterListenTarget {
  const isWildcard = hostname === '0.0.0.0' || hostname === '::';
  const bindTarget = `${formatHostForAuthority(hostname)}:${String(port)}`;
  const publicHostname = isWildcard ? 'localhost' : formatHostForAuthority(hostname);
  const scheme = usesHttps ? 'https' : 'http';

  return {
    bindTarget,
    url: `${scheme}://${publicHostname}:${String(port)}`,
  };
}

function formatHostForAuthority(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
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
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Deno adapter shutdown timeout exceeded ${String(timeoutMs)}ms.`));
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

function resolveDenoSignalGlobal(): {
  addSignalListener: (signal: DenoApplicationSignal, handler: () => void) => void;
  removeSignalListener: (signal: DenoApplicationSignal, handler: () => void) => void;
} | undefined {
  const denoGlobal = (globalThis as typeof globalThis & { Deno?: DenoGlobalLike }).Deno;

  if (!denoGlobal?.addSignalListener || !denoGlobal.removeSignalListener) {
    return undefined;
  }

  return {
    addSignalListener: denoGlobal.addSignalListener.bind(denoGlobal),
    removeSignalListener: denoGlobal.removeSignalListener.bind(denoGlobal),
  };
}

async function closeDenoApplicationFromSignal(
  app: Application,
  logger: ApplicationLogger,
  signal: DenoApplicationSignal,
): Promise<void> {
  if (app.state === 'closed') {
    return;
  }

  try {
    await app.close(signal);
    logger.log(`Application closed after receiving ${signal}.`, 'FluoFactory');
  } catch (error: unknown) {
    logger.error('Failed to shut down the application cleanly.', error, 'FluoFactory');
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}
