import {
  createUnsupportedHttpAdapterRealtimeCapability,
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

export interface CloudflareWorkerAdapterOptions extends CreateWebRequestResponseFactoryOptions {}

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
  implements HttpApplicationAdapter {
  private dispatcher?: Dispatcher;

  constructor(private readonly options: CloudflareWorkerAdapterOptions = {}) {}

  async close(): Promise<void> {
    this.dispatcher = undefined;
  }

  getRealtimeCapability() {
    return createUnsupportedHttpAdapterRealtimeCapability(
      'Cloudflare Workers does not expose a server-backed realtime listener lifecycle.',
    );
  }

  async fetch<Env = unknown>(
    request: Request,
    _env?: Env,
    _executionContext?: CloudflareWorkerExecutionContext,
  ): Promise<Response> {
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
