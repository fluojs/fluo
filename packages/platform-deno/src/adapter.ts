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

declare global {
  interface GlobalThis {
    Deno?: DenoGlobalLike;
  }
}

export class DenoHttpApplicationAdapter implements HttpApplicationAdapter {
  private abortController?: AbortController;
  private closeInFlight?: Promise<void>;
  private dispatcher?: Dispatcher;
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
      'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @konekti/websocket/deno for the official raw websocket binding.',
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
      await this.closeInFlight;
      return;
    }

    const server = this.server;
    const abortController = this.abortController;

    this.server = undefined;
    this.abortController = undefined;

    if (!server) {
      this.dispatcher = undefined;
      return;
    }

    this.closeInFlight = (async () => {
      abortController?.abort();
      await server.shutdown();
      await server.finished;
      this.dispatcher = undefined;
    })().finally(() => {
      this.closeInFlight = undefined;
    });

    await this.closeInFlight;
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
