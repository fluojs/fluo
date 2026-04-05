import type {
  CorsOptions,
  Dispatcher,
  HttpApplicationAdapter,
  MiddlewareLike,
  SecurityHeadersOptions,
} from '@konekti/http';
import type {
  Application,
  ApplicationLogger,
  CreateApplicationOptions,
  ModuleType,
  MultipartOptions,
  UploadedFile,
} from '@konekti/runtime';
import { dispatchWebRequest } from '@konekti/runtime/web';
import {
  bootstrapHttpAdapterApplication,
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
  runHttpAdapterApplication,
  type HttpAdapterListenTarget,
} from '@konekti/runtime/internal';

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

export interface BunServeOptions {
  development?: boolean;
  error?: (error: Error) => Response | Promise<Response>;
  fetch(request: Request, server: BunServerLike): Response | Promise<Response>;
  hostname?: BunHostname;
  idleTimeout?: number;
  maxRequestBodySize?: number;
  port?: number;
  tls?: BunTlsOptions;
}

export interface BunServerLike {
  fetch?(request: Request): Response | Promise<Response>;
  hostname?: BunHostname;
  port?: number;
  stop(closeActiveConnections?: boolean): void;
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

export class BunHttpApplicationAdapter implements HttpApplicationAdapter {
  private server?: BunServerLike;

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

  async listen(dispatcher: Dispatcher): Promise<void> {
    const bun = requireBunGlobal();

    const fetch = createBunFetchHandler({
      dispatcher,
      maxBodySize: this.options.maxBodySize,
      multipart: this.options.multipart,
      rawBody: this.options.rawBody,
    });

    this.server = bun.serve({
      development: this.options.development,
      fetch: async (request, server) => {
        const response = await fetch(request);

        if (this.server === undefined) {
          this.server = server;
        }

        return response;
      },
      hostname: this.options.hostname,
      idleTimeout: this.options.idleTimeout,
      maxRequestBodySize: this.options.maxBodySize,
      port: resolvePort(this.options.port),
      tls: this.options.tls,
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
