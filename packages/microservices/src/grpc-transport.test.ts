import { describe, expect, it } from 'vitest';

import { GrpcMicroserviceTransport } from './grpc-transport.js';

class FakeGrpcMetadata {
  private readonly values = new Map<string, unknown[]>();

  set(key: string, value: string): void {
    this.values.set(key.toLowerCase(), [value]);
  }

  get(key: string): unknown {
    return this.values.get(key.toLowerCase()) ?? [];
  }
}

interface FakeGrpcMethodDefinition {
  readonly requestStream?: boolean;
  readonly responseStream?: boolean;
}

type UnaryImplementation = (
  call: { metadata?: FakeGrpcMetadata; request: unknown },
  callback: (error: { code?: number; message?: string } | null, payload?: unknown) => void,
) => void;

class FakeGrpcServer {
  readonly services = new Map<string, Record<string, UnaryImplementation>>();
  bindError: Error | undefined;
  shutdownError: Error | undefined;
  shutdownCount = 0;

  constructor(private readonly runtime: FakeGrpcRuntime) {}

  addService(definition: Record<string, FakeGrpcMethodDefinition>, implementation: Record<string, unknown>): void {
    const methods = new Map<string, UnaryImplementation>();

    for (const [methodName] of Object.entries(definition)) {
      const candidate = implementation[methodName];

      if (typeof candidate === 'function') {
        methods.set(methodName, candidate as UnaryImplementation);
      }
    }

    const key = Object.keys(definition).sort().join(',');
    this.services.set(key, Object.fromEntries(methods));
  }

  bindAsync(address: string, credentials: unknown, callback: (error: Error | null, port: number) => void): void {
    void credentials;

    if (this.bindError) {
      callback(this.bindError, 0);
      return;
    }

    this.runtime.bind(address, this);
    callback(null, 0);
  }

  start(): void {
    return;
  }

  tryShutdown(callback: (error?: Error) => void): void {
    this.shutdownCount += 1;
    callback(this.shutdownError);
  }

  resolveImplementation(serviceDefinition: Record<string, FakeGrpcMethodDefinition>, methodName: string): UnaryImplementation | undefined {
    const key = Object.keys(serviceDefinition).sort().join(',');
    return this.services.get(key)?.[methodName];
  }
}

class FakeGrpcRuntime {
  readonly status = {
    CANCELLED: 1,
    DEADLINE_EXCEEDED: 4,
    INTERNAL: 13,
    INVALID_ARGUMENT: 3,
    UNIMPLEMENTED: 12,
  } as const;

  readonly credentials = {
    createInsecure(): string {
      return 'insecure';
    },
  };

  readonly Metadata = FakeGrpcMetadata;
  readonly Server: new () => FakeGrpcServer;

  private readonly boundServers = new Map<string, FakeGrpcServer>();

  constructor(private readonly packageDefinition: Record<string, unknown>) {
    this.Server = class extends FakeGrpcServer {
      constructor() {
        super(runtimeRef);
      }
    };

    const runtimeRef = this;
  }

  loadPackageDefinition(definition: unknown): unknown {
    void definition;
    return this.packageDefinition;
  }

  makeGenericClientConstructor(serviceDefinition: Record<string, FakeGrpcMethodDefinition>, serviceName: string) {
    const runtime = this;

    return class FakeGrpcClient {
      [methodName: string]: unknown;

      constructor(private readonly address: string) {
        for (const methodName of Object.keys(serviceDefinition)) {
          this[methodName] = (
            payload: unknown,
            metadata: FakeGrpcMetadata,
            options: { deadline?: Date },
            callback: (error: { code?: number; message?: string } | null, response: unknown) => void,
          ) => {
            let cancelled = false;
            let settled = false;

            const settle = (result: () => void) => {
              if (settled) {
                return;
              }

              settled = true;
              result();
            };

            const deadlineMs = options.deadline?.getTime();
            let timer: ReturnType<typeof setTimeout> | undefined;

            if (typeof deadlineMs === 'number') {
              const remaining = deadlineMs - Date.now();

              if (remaining <= 0) {
                settle(() => callback({ code: runtime.status.DEADLINE_EXCEEDED, message: 'deadline exceeded' }, undefined));
                return {
                  cancel() {
                    return;
                  },
                };
              }

              timer = setTimeout(() => {
                settle(() => callback({ code: runtime.status.DEADLINE_EXCEEDED, message: 'deadline exceeded' }, undefined));
              }, remaining);
            }

            void runtime.dispatch(
              this.address,
              serviceDefinition,
              serviceName,
              methodName,
              payload,
              metadata,
              (error, response) => {
                if (timer) {
                  clearTimeout(timer);
                }

                if (cancelled) {
                  return;
                }

                settle(() => callback(error, response));
              },
            );

            return {
              cancel() {
                if (timer) {
                  clearTimeout(timer);
                }

                cancelled = true;
                settle(() => callback({ code: runtime.status.CANCELLED, message: 'cancelled' }, undefined));
              },
            };
          };
        }
      }

      close(): void {
        return;
      }
    };
  }

  bind(address: string, server: FakeGrpcServer): void {
    this.boundServers.set(address, server);
  }

  private async dispatch(
    address: string,
    serviceDefinition: Record<string, FakeGrpcMethodDefinition>,
    serviceName: string,
    methodName: string,
    payload: unknown,
    metadata: FakeGrpcMetadata,
    callback: (error: { code?: number; message?: string } | null, response: unknown) => void,
  ): Promise<void> {
    void serviceName;

    const server = this.boundServers.get(address);

    if (!server) {
      callback({ code: this.status.UNIMPLEMENTED, message: 'server not listening' }, undefined);
      return;
    }

    const implementation = server.resolveImplementation(serviceDefinition, methodName);

    if (!implementation) {
      callback({ code: this.status.UNIMPLEMENTED, message: 'method not implemented' }, undefined);
      return;
    }

    implementation({ request: payload, metadata }, callback);
  }
}

function createGrpcTransport(): { runtime: FakeGrpcRuntime; transport: GrpcMicroserviceTransport } {
  const mathService = class FakeMathService {
    static readonly service = {
      Notify: { requestStream: false, responseStream: false },
      StreamAll: { requestStream: true, responseStream: false },
      Sum: { requestStream: false, responseStream: false },
    } satisfies Record<string, FakeGrpcMethodDefinition>;
  };

  const packageDefinition = {
    konekti: {
      microservices: {
        MathService: mathService,
      },
    },
  };

  const runtime = new FakeGrpcRuntime(packageDefinition);
  const transport = new GrpcMicroserviceTransport({
    grpc: runtime,
    packageName: 'konekti.microservices',
    protoLoader: {
      loadSync() {
        return {};
      },
    },
    protoPath: '/virtual/microservices.proto',
    requestTimeoutMs: 120,
    url: '127.0.0.1:50051',
  });

  return { runtime, transport };
}

describe('GrpcMicroserviceTransport', () => {
  it('supports unary request/reply send() and event dispatch via emit()', async () => {
    const { transport } = createGrpcTransport();
    const events: string[] = [];

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push((packet.payload as { value: string }).value);
        return undefined;
      }

      const input = packet.payload as { a: number; b: number };
      return input.a + input.b;
    });

    await expect(transport.send('MathService.Sum', { a: 2, b: 5 })).resolves.toBe(7);
    await expect(transport.emit('MathService.Notify', { value: 'ok' })).resolves.toBeUndefined();
    expect(events).toEqual(['ok']);

    await transport.close();
  });

  it('preserves handler failure messages from unary RPCs', async () => {
    const { transport } = createGrpcTransport();

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        throw new Error('No message handler registered for pattern "MathService.Sum".');
      }

      return undefined;
    });

    await expect(transport.send('MathService.Sum', { a: 1, b: 1 })).rejects.toThrow(
      'No message handler registered for pattern "MathService.Sum".',
    );

    await transport.close();
  });

  it('rejects invalid pattern format for send()', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    await expect(transport.send('invalid-pattern', {})).rejects.toThrow(
      'Invalid gRPC pattern "invalid-pattern". Expected "<Service>.<Method>"',
    );

    await transport.close();
  });

  it('rejects request on timeout with deadline handling', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => {
      await new Promise<void>(() => undefined);
    });

    await expect(transport.send('MathService.Sum', { a: 1, b: 2 })).rejects.toThrow(
      'gRPC request timed out after 120ms waiting for pattern "MathService.Sum".',
    );

    await transport.close();
  });

  it('rejects request when AbortSignal is already aborted', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => 1);

    const controller = new AbortController();
    controller.abort();

    await expect(transport.send('MathService.Sum', { a: 1, b: 2 }, controller.signal)).rejects.toThrow(
      'gRPC request aborted before dispatch.',
    );

    await transport.close();
  });

  it('rejects in-flight request on AbortSignal cancelation', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => {
      await new Promise<void>(() => undefined);
    });

    const controller = new AbortController();
    const pending = transport.send('MathService.Sum', { a: 1, b: 2 }, controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(pending).rejects.toThrow('gRPC request aborted.');

    await transport.close();
  });

  it('keeps concurrent unary requests correlated', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async (packet) => {
      if (packet.kind !== 'message') {
        return undefined;
      }

      const input = packet.payload as { delayMs: number; value: number };
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      return input.value * 2;
    });

    const [first, second] = await Promise.all([
      transport.send('MathService.Sum', { delayMs: 80, value: 1 }),
      transport.send('MathService.Sum', { delayMs: 10, value: 2 }),
    ]);

    expect(first).toBe(2);
    expect(second).toBe(4);

    await transport.close();
  });

  it('rejects pending requests when close() is called before reply', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => {
      await new Promise<void>(() => undefined);
    });

    const pending = transport.send('MathService.Sum', { a: 1, b: 2 });
    await transport.close();

    await expect(pending).rejects.toThrow('gRPC microservice transport closed before response.');
  });

  it('loads optional peers lazily and reports missing grpc peer clearly', async () => {
    const transport = new GrpcMicroserviceTransport({
      moduleLoader: async () => {
        throw new Error('module not found');
      },
      packageName: 'konekti.microservices',
      protoPath: '/virtual/microservices.proto',
      url: '127.0.0.1:50051',
    });

    await expect(transport.listen(async () => undefined)).rejects.toThrow(
      'Missing optional peer dependency "@grpc/grpc-js" required by GrpcMicroserviceTransport',
    );
  });

  it('rolls back startup when bindAsync fails during listen()', async () => {
    const mathService = class FakeMathService {
      static readonly service = {
        Sum: { requestStream: false, responseStream: false },
      } satisfies Record<string, FakeGrpcMethodDefinition>;
    };

    const runtime = new FakeGrpcRuntime({
      konekti: {
        microservices: {
          MathService: mathService,
        },
      },
    });
    const server = new FakeGrpcServer(runtime);
    server.bindError = new Error('bind failed');
    const transport = new GrpcMicroserviceTransport({
      grpc: runtime,
      packageName: 'konekti.microservices',
      protoLoader: {
        loadSync() {
          return {};
        },
      },
      protoPath: '/virtual/microservices.proto',
      server,
      url: '127.0.0.1:50051',
    });

    await expect(transport.listen(async () => undefined)).rejects.toThrow('bind failed');
    expect(server.shutdownCount).toBe(1);
  });
});
