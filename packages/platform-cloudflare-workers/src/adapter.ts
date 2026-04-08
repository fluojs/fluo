import {
  createFetchStyleHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@konekti/http';
import {
  bootstrapHttpAdapterApplication,
  type BootstrapHttpAdapterApplicationOptions,
} from '@konekti/runtime/internal/http-adapter';
import type {
  Application,
  ModuleType,
  UploadedFile,
} from '@konekti/runtime';
import {
  dispatchWebRequest,
  type CreateWebRequestResponseFactoryOptions,
} from '@konekti/runtime/web';

declare module '@konekti/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

const WORKER_DISPATCHER_NOT_READY_MESSAGE =
  'Cloudflare Workers adapter received a request before dispatcher binding completed.';

export interface CloudflareWorkerExecutionContext {
  passThroughOnException?(): void;
  waitUntil(promise: Promise<unknown>): void;
}

export type CloudflareWorkerWebSocketMessage = ArrayBuffer | ArrayBufferView | Blob | string;

export interface CloudflareWorkerWebSocket
  extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
  accept(): void;
}

export interface CloudflareWorkerWebSocketPair {
  0: CloudflareWorkerWebSocket;
  1: CloudflareWorkerWebSocket;
}

export type CloudflareWorkerWebSocketPairFactory = () => CloudflareWorkerWebSocketPair;

export interface CloudflareWorkerWebSocketUpgradeResult {
  response: Response;
  serverSocket: CloudflareWorkerWebSocket;
}

export interface CloudflareWorkerWebSocketUpgradeHost {
  upgrade(request: Request): CloudflareWorkerWebSocketUpgradeResult;
}

export interface CloudflareWorkerWebSocketBinding {
  fetch(request: Request, host: CloudflareWorkerWebSocketUpgradeHost): Response | Promise<Response>;
}

export interface CloudflareWorkerWebSocketBindingHost {
  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void;
}

export interface CloudflareWorkerAdapterOptions extends CreateWebRequestResponseFactoryOptions {
  createWebSocketPair?: CloudflareWorkerWebSocketPairFactory;
}

export interface BootstrapCloudflareWorkerApplicationOptions
  extends BootstrapHttpAdapterApplicationOptions,
    CloudflareWorkerAdapterOptions {}

export interface CloudflareWorkerHandler<Env = unknown> {
  fetch(
    request: Request,
    env: Env,
    executionContext: CloudflareWorkerExecutionContext,
  ): Promise<Response>;
}

export interface CloudflareWorkerApplication<Env = unknown>
  extends CloudflareWorkerHandler<Env> {
  readonly adapter: CloudflareWorkerHttpApplicationAdapter;
  readonly app: Application;

  close(signal?: string): Promise<void>;
}

export interface CloudflareWorkerEntrypoint<Env = unknown>
  extends CloudflareWorkerHandler<Env> {
  close(signal?: string): Promise<void>;
  ready(): Promise<CloudflareWorkerApplication<Env>>;
}

export class CloudflareWorkerHttpApplicationAdapter
  implements HttpApplicationAdapter, CloudflareWorkerWebSocketBindingHost {
  private dispatcher?: Dispatcher;
  private websocketBinding?: CloudflareWorkerWebSocketBinding;

  constructor(private readonly options: CloudflareWorkerAdapterOptions = {}) {}

  async close(): Promise<void> {
    this.dispatcher = undefined;
  }

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @konekti/websockets/cloudflare-workers for the official raw websocket binding.',
      { support: 'supported' },
    );
  }

  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void {
    this.websocketBinding = binding;
  }

  async fetch<Env = unknown>(
    request: Request,
    _env?: Env,
    _executionContext?: CloudflareWorkerExecutionContext,
  ): Promise<Response> {
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
}

export function createCloudflareWorkerAdapter(
  options: CloudflareWorkerAdapterOptions = {},
): CloudflareWorkerHttpApplicationAdapter {
  return new CloudflareWorkerHttpApplicationAdapter(options);
}

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

declare global {
  interface ResponseInit {
    webSocket?: CloudflareWorkerWebSocket;
  }

  interface GlobalThis {
    WebSocketPair?: new () => CloudflareWorkerWebSocketPair;
  }
}
