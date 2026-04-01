import type { MicroserviceTransport, TransportHandler } from './types.js';

type DynamicImport = (specifier: string) => Promise<unknown>;

interface GrpcMetadataLike {
  get(key: string): unknown;
  set(key: string, value: string): void;
}

interface GrpcServerCredentialsFactoryLike {
  createInsecure(): unknown;
}

interface GrpcServerLike {
  addService(serviceDefinition: unknown, implementation: Record<string, unknown>): void;
  bindAsync(address: string, credentials: unknown, callback: (error: Error | null, port: number) => void): void;
  forceShutdown?(): void;
  start(): void;
  tryShutdown?(callback: (error?: Error) => void): void;
}

interface GrpcClientLike {
  close?(): void;
  [methodName: string]: unknown;
}

interface GrpcMethodDefinitionLike {
  path?: string;
  requestStream?: boolean;
  responseStream?: boolean;
}

interface GrpcServiceConstructorLike {
  readonly service: Readonly<Record<string, GrpcMethodDefinitionLike>>;
}

interface GrpcJsLike {
  Metadata: new () => GrpcMetadataLike;
  Server: new () => GrpcServerLike;
  credentials: GrpcServerCredentialsFactoryLike;
  loadPackageDefinition(packageDefinition: unknown): unknown;
  makeGenericClientConstructor(
    serviceDefinition: unknown,
    serviceName: string,
    options?: unknown,
  ): new (address: string, credentials: unknown, options?: unknown) => GrpcClientLike;
  status?: {
    CANCELLED?: number;
    DEADLINE_EXCEEDED?: number;
    INTERNAL?: number;
    INVALID_ARGUMENT?: number;
    UNIMPLEMENTED?: number;
  };
}

interface ProtoLoaderLike {
  loadSync(protoPath: string, options?: Record<string, unknown>): unknown;
}

interface PendingRequest {
  reject(error: unknown): void;
  resolve(value: unknown): void;
}

interface ServiceRuntime {
  readonly client: GrpcClientLike;
  readonly serviceDefinition: unknown;
}

interface ParsedGrpcPattern {
  readonly methodName: string;
  readonly serviceName: string;
}

const DEFAULT_KIND_METADATA_KEY = 'x-konekti-kind';
const DEFAULT_MESSAGE_KIND_VALUE = 'message';
const DEFAULT_EVENT_KIND_VALUE = 'event';

const grpcKinds = {
  event: 'event',
  message: 'message',
} as const;

type GrpcTransportKind = typeof grpcKinds[keyof typeof grpcKinds];

export interface GrpcMicroserviceTransportOptions {
  protoPath: string;
  packageName: string;
  url: string;
  services?: readonly string[];
  requestTimeoutMs?: number;
  loaderOptions?: Record<string, unknown>;
  channelOptions?: Record<string, unknown>;
  credentials?: unknown;
  kindMetadataKey?: string;
  messageKindMetadataValue?: string;
  eventKindMetadataValue?: string;
  grpc?: GrpcJsLike;
  protoLoader?: ProtoLoaderLike;
  moduleLoader?: DynamicImport;
  server?: GrpcServerLike;
}

export class GrpcMicroserviceTransport implements MicroserviceTransport {
  private closing = false;
  private readonly clients = new Map<string, ServiceRuntime>();
  private grpc: GrpcJsLike | undefined;
  private handler: TransportHandler | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private packageRoot: Readonly<Record<string, unknown>> | undefined;
  private readonly requestTimeoutMs: number;
  private readonly server: GrpcServerLike | undefined;
  private resolvedServer: GrpcServerLike | undefined;

  constructor(private readonly options: GrpcMicroserviceTransportOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.server = options.server;
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.closing = false;
    this.handler = handler;

    if (this.listening) {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = (async () => {
      const grpc = await this.resolveGrpc();
      const protoLoader = await this.resolveProtoLoader();
      const packageDefinition = protoLoader.loadSync(this.options.protoPath, this.options.loaderOptions);
      const loadedDefinition = grpc.loadPackageDefinition(packageDefinition);
      const packageRoot = this.resolvePackageRoot(loadedDefinition);
      const targetServices = this.resolveTargetServices(packageRoot);
      const server = this.server ?? new grpc.Server();
      let hasUnaryMethod = false;

      try {
        for (const [serviceName, serviceConstructor] of targetServices) {
          const implementation = this.buildServiceImplementation(serviceName, serviceConstructor);

          if (Object.keys(implementation).length === 0) {
            continue;
          }

          hasUnaryMethod = true;
          server.addService(serviceConstructor.service, implementation);
        }

        if (!hasUnaryMethod) {
          throw new Error('GrpcMicroserviceTransport could not register any unary RPC handlers. Unary methods are required in v1.');
        }

        await this.bindServer(server, grpc);
      } catch (error) {
        await this.shutdownServer(server);
        throw error;
      }

      this.grpc = grpc;
      this.packageRoot = packageRoot;
      this.resolvedServer = server;
      this.listening = true;
    })();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closing) {
      throw new Error('GrpcMicroserviceTransport is closing. Wait for close() to complete before send().');
    }

    if (!this.listening) {
      throw new Error('GrpcMicroserviceTransport is not listening. Call listen() before send().');
    }

    const parsed = parseGrpcPattern(pattern);

    return await this.callUnary(parsed, payload, grpcKinds.message, signal);
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (this.closing) {
      throw new Error('GrpcMicroserviceTransport is closing. Wait for close() to complete before emit().');
    }

    if (!this.listening) {
      throw new Error('GrpcMicroserviceTransport is not listening. Call listen() before emit().');
    }

    const parsed = parseGrpcPattern(pattern);

    await this.callUnary(parsed, payload, grpcKinds.event, undefined);
  }

  async close(): Promise<void> {
    this.closing = true;
    let closeError: unknown;

    if (this.listenPromise) {
      await this.listenPromise;
    }

    try {
      if (this.resolvedServer) {
        await this.shutdownServer(this.resolvedServer);
      }

      for (const service of this.clients.values()) {
        try {
          service.client.close?.();
        } catch (error) {
          closeError ??= error;
        }
      }
    } catch (error) {
      closeError ??= error;
    } finally {
      this.handler = undefined;
      this.listening = false;
      this.resolvedServer = undefined;
      this.clients.clear();
      this.packageRoot = undefined;

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('gRPC microservice transport closed before response.'));
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  private buildServiceImplementation(
    serviceName: string,
    serviceConstructor: GrpcServiceConstructorLike,
  ): Record<string, unknown> {
    const implementation: Record<string, unknown> = {};

    for (const [methodName, methodDefinition] of Object.entries(serviceConstructor.service)) {
      if (methodDefinition.requestStream || methodDefinition.responseStream) {
        continue;
      }

      implementation[methodName] = (
        call: { metadata?: GrpcMetadataLike; request: unknown },
        callback: (error: Error | null | { code?: number; message: string }, response?: unknown) => void,
      ) => {
        void this.handleInboundUnary(serviceName, methodName, call).then((response) => {
          callback(null, response);
        }).catch((error) => {
          callback(this.mapGrpcHandlerError(error));
        });
      };
    }

    return implementation;
  }

  private async handleInboundUnary(
    serviceName: string,
    methodName: string,
    call: { metadata?: GrpcMetadataLike; request: unknown },
  ): Promise<unknown> {
    const handler = this.handler;

    if (!handler) {
      throw this.createGrpcError(
        this.resolveGrpcStatusCode('UNIMPLEMENTED', 12),
        'No message handler registered for pattern.',
      );
    }

    const pattern = `${serviceName}.${methodName}`;
    const kind = this.resolveInboundKind(call.metadata);

    if (kind === grpcKinds.event) {
      try {
        await handler({
          kind: 'event',
          pattern,
          payload: call.request,
        });
      } catch (error) {
        this.logEventHandlerFailure(error);
      }

      return {};
    }

    return await handler({
      kind: 'message',
      pattern,
      payload: call.request,
    });
  }

  private async callUnary(
    parsedPattern: ParsedGrpcPattern,
    payload: unknown,
    kind: GrpcTransportKind,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const runtime = this.getServiceRuntime(parsedPattern.serviceName);
    const method = runtime.client[parsedPattern.methodName];

    if (typeof method !== 'function') {
      throw new Error(`GrpcMicroserviceTransport could not resolve unary method "${parsedPattern.serviceName}.${parsedPattern.methodName}".`);
    }

    const requestId = crypto.randomUUID();

    return await new Promise<unknown>((resolve, reject) => {
      let abortHandler: (() => void) | undefined;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let activeCall: { cancel?: () => void } | undefined;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }

        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }

        this.pending.delete(requestId);
      };

      const entry: PendingRequest = {
        resolve: (value: unknown) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve(value);
        },
        reject: (error: unknown) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          reject(error);
        },
      };

      this.pending.set(requestId, entry);

      const metadata = this.createMetadata(kind);
      const deadline = new Date(Date.now() + this.requestTimeoutMs);

      timeout = setTimeout(() => {
        entry.reject(new Error(`gRPC request timed out after ${String(this.requestTimeoutMs)}ms waiting for pattern "${parsedPattern.serviceName}.${parsedPattern.methodName}".`));
        activeCall?.cancel?.();
      }, this.requestTimeoutMs);

      if (signal) {
        if (signal.aborted) {
          entry.reject(new Error('gRPC request aborted before dispatch.'));
          return;
        }

        abortHandler = () => {
          activeCall?.cancel?.();
          entry.reject(new Error('gRPC request aborted.'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      void Promise.resolve().then(() => {
        if (this.closing) {
          entry.reject(new Error('gRPC microservice transport closed before response.'));
          return;
        }

        activeCall = (method as (
          request: unknown,
          metadata: GrpcMetadataLike,
          options: { deadline: Date },
          callback: (error: { code?: number; message?: string } | null, response: unknown) => void,
        ) => { cancel?: () => void }).call(
          runtime.client,
          payload,
          metadata,
          { deadline },
          (error, response) => {
            if (error) {
              if (signal?.aborted) {
                entry.reject(new Error('gRPC request aborted.'));
                return;
              }

              if (isGrpcStatus(error, this.resolveGrpcStatusCode('DEADLINE_EXCEEDED', 4))) {
                entry.reject(new Error(`gRPC request timed out after ${String(this.requestTimeoutMs)}ms waiting for pattern "${parsedPattern.serviceName}.${parsedPattern.methodName}".`));
                return;
              }

              const message = typeof error.message === 'string' && error.message.length > 0
                ? error.message
                : 'Unhandled gRPC transport error';
              entry.reject(new Error(message));
              return;
            }

            entry.resolve(response);
          },
        );
      }).catch((error: unknown) => {
        entry.reject(error instanceof Error ? error : new Error('Failed to send gRPC request.'));
      });
    });
  }

  private getServiceRuntime(serviceName: string): ServiceRuntime {
    const cached = this.clients.get(serviceName);

    if (cached) {
      return cached;
    }

    const grpc = this.grpc;

    if (!grpc || !this.packageRoot) {
      throw new Error('GrpcMicroserviceTransport is not initialized. Call listen() before send() or emit().');
    }

    const serviceConstructor = this.resolveServiceConstructor(this.packageRoot, serviceName);
    const credentials = this.options.credentials ?? grpc.credentials.createInsecure();
    const ClientConstructor = grpc.makeGenericClientConstructor(
      serviceConstructor.service,
      serviceName,
      {},
    );
    const client = new ClientConstructor(this.options.url, credentials, this.options.channelOptions);
    const runtime = {
      client,
      serviceDefinition: serviceConstructor.service,
    } satisfies ServiceRuntime;

    this.clients.set(serviceName, runtime);

    return runtime;
  }

  private resolvePackageRoot(loadedDefinition: unknown): Readonly<Record<string, unknown>> {
    const packageName = this.options.packageName.trim();

    if (packageName.length === 0) {
      throw new Error('GrpcMicroserviceTransport requires packageName to resolve proto services.');
    }

    const path = packageName.split('.').filter((segment) => segment.length > 0);

    if (path.length === 0) {
      throw new Error('GrpcMicroserviceTransport requires packageName to resolve proto services.');
    }

    let current: unknown = loadedDefinition;

    for (const segment of path) {
      if (!current || typeof current !== 'object') {
        throw new Error(`GrpcMicroserviceTransport could not resolve proto package "${packageName}".`);
      }

      const next = (current as Record<string, unknown>)[segment];

      if (!next) {
        throw new Error(`GrpcMicroserviceTransport could not resolve proto package "${packageName}".`);
      }

      current = next;
    }

    if (!current || typeof current !== 'object') {
      throw new Error(`GrpcMicroserviceTransport could not resolve proto package "${packageName}".`);
    }

    return current as Readonly<Record<string, unknown>>;
  }

  private resolveTargetServices(
    packageRoot: Readonly<Record<string, unknown>>,
  ): ReadonlyArray<readonly [string, GrpcServiceConstructorLike]> {
    const names = this.options.services && this.options.services.length > 0
      ? [...this.options.services]
      : Object.keys(packageRoot).filter((name) => this.isServiceConstructor(packageRoot[name]));

    if (names.length === 0) {
      throw new Error(`GrpcMicroserviceTransport found no services under proto package "${this.options.packageName}".`);
    }

    return names.map((name) => [name, this.resolveServiceConstructor(packageRoot, name)] as const);
  }

  private resolveServiceConstructor(
    packageRoot: Readonly<Record<string, unknown>>,
    serviceName: string,
  ): GrpcServiceConstructorLike {
    const candidate = packageRoot[serviceName];

    if (!this.isServiceConstructor(candidate)) {
      throw new Error(`GrpcMicroserviceTransport could not resolve service "${serviceName}" in package "${this.options.packageName}".`);
    }

    return candidate;
  }

  private isServiceConstructor(value: unknown): value is GrpcServiceConstructorLike {
    if (!value || typeof value !== 'function') {
      return false;
    }

    const service = (value as { service?: unknown }).service;

    return !!service && typeof service === 'object';
  }

  private async bindServer(server: GrpcServerLike, grpc: GrpcJsLike): Promise<void> {
    const credentials = this.options.credentials ?? grpc.credentials.createInsecure();

    await new Promise<void>((resolve, reject) => {
      server.bindAsync(this.options.url, credentials, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    server.start();
  }

  private async shutdownServer(server: GrpcServerLike): Promise<void> {
    if (server.tryShutdown) {
      await new Promise<void>((resolve, reject) => {
        server.tryShutdown?.((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      return;
    }

    server.forceShutdown?.();
  }

  private async resolveGrpc(): Promise<GrpcJsLike> {
    if (this.options.grpc) {
      return this.options.grpc;
    }

    const loaded = await this.loadPeerModule('@grpc/grpc-js') as { default?: unknown };
    const grpc = (loaded.default ?? loaded) as GrpcJsLike;

    if (!grpc || typeof grpc !== 'object' || typeof grpc.loadPackageDefinition !== 'function') {
      throw new Error('Failed to load @grpc/grpc-js runtime module.');
    }

    return grpc;
  }

  private async resolveProtoLoader(): Promise<ProtoLoaderLike> {
    if (this.options.protoLoader) {
      return this.options.protoLoader;
    }

    const loaded = await this.loadPeerModule('@grpc/proto-loader') as { default?: unknown };
    const protoLoader = (loaded.default ?? loaded) as ProtoLoaderLike;

    if (!protoLoader || typeof protoLoader !== 'object' || typeof protoLoader.loadSync !== 'function') {
      throw new Error('Failed to load @grpc/proto-loader runtime module.');
    }

    return protoLoader;
  }

  private async loadPeerModule(specifier: string): Promise<unknown> {
    const moduleLoader = this.options.moduleLoader ?? defaultDynamicImport;

    try {
      return await moduleLoader(specifier);
    } catch (error) {
      throw createMissingPeerDependencyError(specifier, error);
    }
  }

  private createMetadata(kind: GrpcTransportKind): GrpcMetadataLike {
    const grpc = this.grpc;

    if (!grpc) {
      throw new Error('GrpcMicroserviceTransport is not initialized. Call listen() before send() or emit().');
    }

    const metadata = new grpc.Metadata();
    metadata.set(this.options.kindMetadataKey ?? DEFAULT_KIND_METADATA_KEY, this.kindMetadataValue(kind));

    return metadata;
  }

  private resolveInboundKind(metadata: GrpcMetadataLike | undefined): GrpcTransportKind {
    if (!metadata || typeof metadata.get !== 'function') {
      return grpcKinds.message;
    }

    const values = metadata.get(this.options.kindMetadataKey ?? DEFAULT_KIND_METADATA_KEY);
    const first = Array.isArray(values) ? values[0] : values;
    const value = typeof first === 'string' ? first : String(first ?? '');

    if (value === (this.options.eventKindMetadataValue ?? DEFAULT_EVENT_KIND_VALUE)) {
      return grpcKinds.event;
    }

    return grpcKinds.message;
  }

  private kindMetadataValue(kind: GrpcTransportKind): string {
    if (kind === grpcKinds.event) {
      return this.options.eventKindMetadataValue ?? DEFAULT_EVENT_KIND_VALUE;
    }

    return this.options.messageKindMetadataValue ?? DEFAULT_MESSAGE_KIND_VALUE;
  }

  private mapGrpcHandlerError(error: unknown): { code?: number; message: string } {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      const candidate = error as { code?: unknown; message?: unknown };
      const message = typeof candidate.message === 'string' && candidate.message.length > 0
        ? candidate.message
        : 'Unhandled microservice error';

      return {
        code: typeof candidate.code === 'number' ? candidate.code : this.resolveGrpcStatusCode('INTERNAL', 13),
        message,
      };
    }

    const message = error instanceof Error
      ? error.message
      : 'Unhandled microservice error';

    if (message.includes('No message handler registered for pattern')) {
      return this.createGrpcError(this.resolveGrpcStatusCode('UNIMPLEMENTED', 12), message);
    }

    if (message.includes('Invalid gRPC pattern')) {
      return this.createGrpcError(this.resolveGrpcStatusCode('INVALID_ARGUMENT', 3), message);
    }

    return this.createGrpcError(this.resolveGrpcStatusCode('INTERNAL', 13), message);
  }

  private createGrpcError(code: number, message: string): { code: number; message: string } {
    return { code, message };
  }

  private resolveGrpcStatusCode(name: 'CANCELLED' | 'DEADLINE_EXCEEDED' | 'INTERNAL' | 'INVALID_ARGUMENT' | 'UNIMPLEMENTED', fallback: number): number {
    const status = this.grpc?.status;
    const code = status?.[name];

    return typeof code === 'number' ? code : fallback;
  }

  private logEventHandlerFailure(error: unknown): void {
    console.error('[konekti][GrpcMicroserviceTransport] event handler failed:', error);
  }
}

function parseGrpcPattern(pattern: string): ParsedGrpcPattern {
  const segments = pattern.split('.');

  if (segments.length !== 2 || segments[0]?.length === 0 || segments[1]?.length === 0) {
    throw new Error(
      `Invalid gRPC pattern "${pattern}". Expected "<Service>.<Method>" matching unary proto service and method names.`,
    );
  }

  return {
    serviceName: segments[0],
    methodName: segments[1],
  };
}

function isGrpcStatus(error: { code?: number } | null | undefined, code: number): boolean {
  return typeof error?.code === 'number' && error.code === code;
}

function createMissingPeerDependencyError(specifier: string, originalError: unknown): Error {
  const details = originalError instanceof Error && typeof originalError.message === 'string'
    ? ` (${originalError.message})`
    : '';

  return new Error(
    `Missing optional peer dependency "${specifier}" required by GrpcMicroserviceTransport. Install it with "pnpm add ${specifier}" in your application.${details}`,
  );
}

const defaultDynamicImport: DynamicImport = async (specifier) => {
  return await import(specifier);
};
