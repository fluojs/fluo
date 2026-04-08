import type {
  CorsOptions,
  Dispatcher,
  HttpApplicationAdapter,
  MiddlewareLike,
  SecurityHeadersOptions,
} from '@konekti/http';
import { createFetchStyleHttpAdapterRealtimeCapability } from '@konekti/http';
import type {
  Application,
  ApplicationLogger,
  CreateApplicationOptions,
  ModuleType,
  MultipartOptions,
  UploadedFile,
} from '@konekti/runtime';
import {
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
} from '@konekti/runtime/node';
import { dispatchWebRequest } from '@konekti/runtime/web';
import {
  bootstrapHttpAdapterApplication,
  runHttpAdapterApplication,
  type HttpAdapterListenTarget,
} from '@konekti/runtime/internal/http-adapter';

declare module '@konekti/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

type BunGlobal = {
  serve(options: BunServeOptions): BunServerLike;
};

type BunHostname = string;
export type BunApplicationSignal = 'SIGINT' | 'SIGTERM';
export type BunCorsInput = false | string | string[] | CorsOptions;
export type BunTlsOptions = Record<string, unknown>;
export type BunWebSocketMessage = string | ArrayBuffer | Uint8Array;

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

export interface BunWebSocketBinding<TData = unknown> {
  fetch(request: Request, server: BunServerLike): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  websocket: BunWebSocketHandler<TData>;
}

export interface BunWebSocketBindingHost {
  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void;
}

export interface BunServeOptions {
  development?: boolean;
  error?: (error: Error) => Response | Promise<Response>;
  fetch(request: Request, server: BunServerLike): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  hostname?: BunHostname;
  idleTimeout?: number;
  maxRequestBodySize?: number;
  port?: number;
  tls?: BunTlsOptions;
  websocket?: BunWebSocketHandler;
}

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

export interface BunAdapterOptions {
  development?: boolean;
  hostname?: BunHostname;
  idleTimeout?: number;
  maxBodySize?: number;
  multipart?: MultipartOptions;
  port?: number;
  rawBody?: boolean;
  stopActiveConnections?: boolean;
  tls?: BunTlsOptions;
}

export interface CreateBunFetchHandlerOptions {
  dispatcher: Dispatcher;
  dispatcherNotReadyMessage?: string;
  maxBodySize?: number;
  multipart?: MultipartOptions;
  rawBody?: boolean;
}

export interface BootstrapBunApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  cors?: BunCorsInput;
  development?: boolean;
  globalPrefix?: string;
  globalPrefixExclude?: readonly string[];
  hostname?: BunHostname;
  idleTimeout?: number;
  logger?: ApplicationLogger;
  maxBodySize?: number;
  middleware?: MiddlewareLike[];
  multipart?: MultipartOptions;
  port?: number;
  rawBody?: boolean;
  securityHeaders?: false | SecurityHeadersOptions;
  stopActiveConnections?: boolean;
  tls?: BunTlsOptions;
}

export interface RunBunApplicationOptions extends BootstrapBunApplicationOptions {
  forceExitTimeoutMs?: number;
  shutdownSignals?: false | readonly BunApplicationSignal[];
}

const DEFAULT_PORT = 3000;
const DEFAULT_DISPATCHER_NOT_READY_MESSAGE = 'Bun adapter received a request before dispatcher binding completed.';
const BUN_WEBSOCKET_SUPPORT_REASON =
  'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @konekti/websockets/bun for the official raw websocket binding.';

export class BunHttpApplicationAdapter implements HttpApplicationAdapter, BunWebSocketBindingHost {
  private server?: BunServerLike;
  private websocketBinding?: BunWebSocketBinding<unknown>;

  constructor(private readonly options: BunAdapterOptions = {}) {}

  getServer(): BunServerLike | undefined {
    return this.server;
  }

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

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      BUN_WEBSOCKET_SUPPORT_REASON,
      { support: 'supported' },
    );
  }

  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void {
    if (this.server) {
      throw new Error('Bun websocket binding must be configured before Bun adapter listen() starts the server.');
    }

    this.websocketBinding = binding;
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    const bun = requireBunGlobal();
    const websocketBinding = this.websocketBinding;

    const fetch = createBunFetchHandler({
      dispatcher,
      maxBodySize: this.options.maxBodySize,
      multipart: this.options.multipart,
      rawBody: this.options.rawBody,
    });

    this.server = bun.serve({
      development: this.options.development,
      fetch: async (request, server) => {
        if (this.server === undefined) {
          this.server = server;
        }

        if (websocketBinding && isWebSocketUpgradeRequest(request)) {
          return await websocketBinding.fetch(request, server);
        }

        const response = await fetch(request);

        return response;
      },
      hostname: this.options.hostname,
      idleTimeout: this.options.idleTimeout,
      maxRequestBodySize: this.options.maxBodySize,
      port: resolvePort(this.options.port),
      tls: this.options.tls,
      websocket: websocketBinding?.websocket,
    });
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    server.stop(this.options.stopActiveConnections);
  }
}

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

export function createBunAdapter(options: BunAdapterOptions = {}): HttpApplicationAdapter {
  return new BunHttpApplicationAdapter(options);
}

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

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}
