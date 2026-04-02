import { describe, expect, it } from 'vitest';

import { GrpcMicroserviceTransport } from './grpc-transport.js';
import type { ServerStreamWriter } from './types.js';

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

type ServerStreamImplementation = (
  call: { metadata?: FakeGrpcMetadata; request: unknown; write(data: unknown): boolean; end(): void },
) => void;

type ClientStreamImplementation = (
  call: FakeReadableStream & { metadata?: FakeGrpcMetadata },
  callback: (error: { code?: number; message?: string } | null, payload?: unknown) => void,
) => void;

type BidiStreamImplementation = (
  call: FakeBidiHalf & { metadata?: FakeGrpcMetadata },
) => void;

type ServiceImplementation = UnaryImplementation | ServerStreamImplementation | ClientStreamImplementation | BidiStreamImplementation;

class FakeGrpcServer {
  readonly services = new Map<string, Record<string, ServiceImplementation>>();
  bindError: Error | undefined;
  shutdownError: Error | undefined;
  shutdownCount = 0;

  constructor(private readonly runtime: FakeGrpcRuntime) {}

  addService(definition: Record<string, FakeGrpcMethodDefinition>, implementation: Record<string, unknown>): void {
    const methods = new Map<string, ServiceImplementation>();

    for (const [methodName] of Object.entries(definition)) {
      const candidate = implementation[methodName];

      if (typeof candidate === 'function') {
        methods.set(methodName, candidate as ServiceImplementation);
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

  resolveImplementation(serviceDefinition: Record<string, FakeGrpcMethodDefinition>, methodName: string): ServiceImplementation | undefined {
    const key = Object.keys(serviceDefinition).sort().join(',');
    return this.services.get(key)?.[methodName];
  }
}

class FakeReadableStream {
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  private readonly pendingEvents: Array<{ event: string; args: unknown[] }> = [];
  private cancelled = false;

  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);

    // Replay any buffered events for this event type
    const remaining: Array<{ event: string; args: unknown[] }> = [];

    for (const pending of this.pendingEvents) {
      if (pending.event === event) {
        listener(...pending.args);
      } else {
        remaining.push(pending);
      }
    }

    this.pendingEvents.length = 0;
    this.pendingEvents.push(...remaining);

    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    if (this.cancelled) {
      return;
    }

    const eventListeners = this.listeners.get(event) ?? [];

    if (eventListeners.length === 0) {
      this.pendingEvents.push({ event, args });
      return;
    }

    for (const listener of eventListeners) {
      listener(...args);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.emit('error', new Error('cancelled'));
  }
}

class FakeDuplexStream extends FakeReadableStream {
  private ended = false;
  readonly written: unknown[] = [];

  write(data: unknown): boolean {
    if (!this.ended) {
      this.written.push(data);
    }

    return true;
  }

  end(): void {
    if (!this.ended) {
      this.ended = true;
    }
  }
}

function createBidiStreamPair(): { clientStream: FakeBidiHalf; serverStream: FakeBidiHalf } {
  const clientStream = new FakeBidiHalf();
  const serverStream = new FakeBidiHalf();
  clientStream.setPeer(serverStream);
  serverStream.setPeer(clientStream);
  return { clientStream, serverStream };
}

class FakeBidiHalf extends FakeReadableStream {
  private writeEnded = false;
  readonly written: unknown[] = [];
  private peer: FakeBidiHalf | undefined;

  setPeer(peer: FakeBidiHalf): void {
    this.peer = peer;
  }

  write(data: unknown): boolean {
    if (!this.writeEnded) {
      this.written.push(data);
      this.peer?.emit('data', data);
    }

    return true;
  }

  end(): void {
    if (!this.writeEnded) {
      this.writeEnded = true;
      this.peer?.emit('end');
    }
  }

  destroy(err?: Error): void {
    if (!this.writeEnded) {
      this.writeEnded = true;
    }

    if (err) {
      this.peer?.emit('error', err);
    } else {
      this.peer?.emit('end');
    }
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
        for (const [methodName, methodDef] of Object.entries(serviceDefinition)) {
          if (methodDef.requestStream && methodDef.responseStream) {
            this[methodName] = (
              metadata: FakeGrpcMetadata,
            ) => {
              const { clientStream, serverStream } = createBidiStreamPair();

              void runtime.dispatchBidiStream(
                this.address,
                serviceDefinition,
                serviceName,
                methodName,
                metadata,
                serverStream,
              );

              return clientStream;
            };
            continue;
          }

          if (methodDef.requestStream) {
            this[methodName] = (
              metadata: FakeGrpcMetadata,
              callback: (error: { code?: number; message?: string } | null, response: unknown) => void,
            ) => {
              const inboundStream = new FakeReadableStream();
              const writable = {
                written: [] as unknown[],
                ended: false,
                write(data: unknown): boolean {
                  this.written.push(data);
                  inboundStream.emit('data', data);
                  return true;
                },
                end(): void {
                  this.ended = true;
                  inboundStream.emit('end');
                },
              };

              void runtime.dispatchClientStream(
                this.address,
                serviceDefinition,
                serviceName,
                methodName,
                metadata,
                inboundStream,
                callback,
              );

              return writable;
            };
            continue;
          }

          if (methodDef.responseStream) {
            this[methodName] = (
              payload: unknown,
              metadata: FakeGrpcMetadata,
            ) => {
              const stream = new FakeReadableStream();

              void runtime.dispatchServerStream(
                this.address,
                serviceDefinition,
                serviceName,
                methodName,
                payload,
                metadata,
                stream,
              );

              return stream;
            };
            continue;
          }

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

    (implementation as UnaryImplementation)({ request: payload, metadata }, callback);
  }

  private async dispatchServerStream(
    address: string,
    serviceDefinition: Record<string, FakeGrpcMethodDefinition>,
    serviceName: string,
    methodName: string,
    payload: unknown,
    metadata: FakeGrpcMetadata,
    stream: FakeReadableStream,
  ): Promise<void> {
    void serviceName;

    const server = this.boundServers.get(address);

    if (!server) {
      stream.emit('error', new Error('server not listening'));
      return;
    }

    const implementation = server.resolveImplementation(serviceDefinition, methodName);

    if (!implementation) {
      stream.emit('error', new Error('method not implemented'));
      return;
    }

    // Yield to microtask queue so the caller has time to register 'data'/'end' listeners
    // on the FakeReadableStream before events fire, matching real gRPC async behavior.
    await Promise.resolve();

    const call = {
      request: payload,
      metadata,
      write(data: unknown): boolean {
        stream.emit('data', data);
        return true;
      },
      end(): void {
        stream.emit('end');
      },
    };

    (implementation as ServerStreamImplementation)(call);
  }

  private async dispatchClientStream(
    address: string,
    serviceDefinition: Record<string, FakeGrpcMethodDefinition>,
    serviceName: string,
    methodName: string,
    metadata: FakeGrpcMetadata,
    inboundStream: FakeReadableStream,
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

    await Promise.resolve();

    const call = Object.assign(inboundStream, { metadata }) as FakeReadableStream & { metadata?: FakeGrpcMetadata };

    (implementation as ClientStreamImplementation)(call, callback);
  }

  private async dispatchBidiStream(
    address: string,
    serviceDefinition: Record<string, FakeGrpcMethodDefinition>,
    serviceName: string,
    methodName: string,
    metadata: FakeGrpcMetadata,
    serverStream: FakeBidiHalf,
  ): Promise<void> {
    void serviceName;

    const server = this.boundServers.get(address);

    if (!server) {
      serverStream.emit('error', new Error('server not listening'));
      return;
    }

    const implementation = server.resolveImplementation(serviceDefinition, methodName);

    if (!implementation) {
      serverStream.emit('error', new Error('method not implemented'));
      return;
    }

    await Promise.resolve();

    const call = Object.assign(serverStream, { metadata }) as FakeBidiHalf & { metadata?: FakeGrpcMetadata };

    (implementation as BidiStreamImplementation)(call);
  }
}

function createGrpcTransport(): { runtime: FakeGrpcRuntime; transport: GrpcMicroserviceTransport } {
  const mathService = class FakeMathService {
    static readonly service = {
      Notify: { requestStream: false, responseStream: false },
      StreamAll: { requestStream: true, responseStream: false },
      StreamBidi: { requestStream: true, responseStream: true },
      StreamData: { requestStream: false, responseStream: true },
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

  it('registers server-streaming handlers and streams data to client via serverStream()', async () => {
    const { transport } = createGrpcTransport();

    transport.listenServerStreaming(async (pattern, payload, writer) => {
      const input = payload as { count: number };

      for (let i = 0; i < input.count; i++) {
        writer.write({ index: i, pattern });
      }

      writer.end();
    });

    await transport.listen(async () => undefined);

    const results: unknown[] = [];

    for await (const item of transport.serverStream('MathService.StreamData', { count: 3 })) {
      results.push(item);
    }

    expect(results).toEqual([
      { index: 0, pattern: 'MathService.StreamData' },
      { index: 1, pattern: 'MathService.StreamData' },
      { index: 2, pattern: 'MathService.StreamData' },
    ]);

    await transport.close();
  });

  it('serverStream() rejects invalid pattern format', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    expect(() => transport.serverStream('invalid-pattern', {})).toThrow(
      'Invalid gRPC pattern "invalid-pattern". Expected "<Service>.<Method>"',
    );

    await transport.close();
  });

  it('serverStream() throws when transport is not listening', () => {
    const { transport } = createGrpcTransport();

    expect(() => transport.serverStream('MathService.StreamData', {})).toThrow(
      'GrpcMicroserviceTransport is not listening. Call listen() before serverStream().',
    );
  });

  it('serverStream() throws when transport is closing', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    const closePromise = transport.close();

    expect(() => transport.serverStream('MathService.StreamData', {})).toThrow(
      'GrpcMicroserviceTransport is closing. Wait for close() to complete before serverStream().',
    );

    await closePromise;
  });

  it('serverStream() supports abort via AbortSignal', async () => {
    const { transport } = createGrpcTransport();
    let writerRef: ServerStreamWriter | undefined;

    transport.listenServerStreaming(async (_pattern, _payload, writer) => {
      writerRef = writer;
      writer.write({ index: 0 });
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    const results: unknown[] = [];
    let streamError: Error | undefined;

    const iterable = transport.serverStream('MathService.StreamData', { count: 100 }, controller.signal);
    const iterator = iterable[Symbol.asyncIterator]();

    const firstResult = await iterator.next();

    if (!firstResult.done) {
      results.push(firstResult.value);
    }

    controller.abort();

    try {
      await iterator.next();
    } catch (error) {
      streamError = error as Error;
    }

    expect(results).toEqual([{ index: 0 }]);
    expect(streamError?.message).toBe('gRPC server stream aborted.');

    void writerRef;
    await transport.close();
  });

  it('server-streaming handler end signals completion to async iterator', async () => {
    const { transport } = createGrpcTransport();

    transport.listenServerStreaming(async (_pattern, _payload, writer) => {
      writer.write({ value: 'first' });
      writer.write({ value: 'second' });
      writer.end();
    });

    await transport.listen(async () => undefined);

    const results: unknown[] = [];

    for await (const item of transport.serverStream('MathService.StreamData', {})) {
      results.push(item);
    }

    expect(results).toEqual([{ value: 'first' }, { value: 'second' }]);

    await transport.close();
  });

  it('serverStream() iterator return() cancels the stream', async () => {
    const { transport } = createGrpcTransport();
    let writerRef: ServerStreamWriter | undefined;

    transport.listenServerStreaming(async (_pattern, _payload, writer) => {
      writerRef = writer;
      writer.write({ value: 'first' });
      writer.write({ value: 'second' });
      writer.write({ value: 'third' });
      writer.end();
    });

    await transport.listen(async () => undefined);

    const results: unknown[] = [];

    for await (const item of transport.serverStream('MathService.StreamData', {})) {
      results.push(item);

      if (results.length === 1) {
        break;
      }
    }

    expect(results).toEqual([{ value: 'first' }]);

    void writerRef;
    await transport.close();
  });

  it('registers client-streaming handlers and collects multiple messages into a single response', async () => {
    const { transport } = createGrpcTransport();

    transport.listenClientStreaming(async (pattern, reader) => {
      let sum = 0;

      for await (const item of reader) {
        sum += (item as { value: number }).value;
      }

      return { pattern, total: sum };
    });

    await transport.listen(async () => undefined);

    const { writer, result } = transport.clientStream('MathService.StreamAll');
    writer.write({ value: 10 });
    writer.write({ value: 20 });
    writer.write({ value: 30 });
    writer.end();

    await expect(result).resolves.toEqual({ pattern: 'MathService.StreamAll', total: 60 });

    await transport.close();
  });

  it('clientStream() throws when transport is not listening', () => {
    const { transport } = createGrpcTransport();

    expect(() => transport.clientStream('MathService.StreamAll')).toThrow(
      'GrpcMicroserviceTransport is not listening. Call listen() before clientStream().',
    );
  });

  it('clientStream() throws when transport is closing', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    const closePromise = transport.close();

    expect(() => transport.clientStream('MathService.StreamAll')).toThrow(
      'GrpcMicroserviceTransport is closing. Wait for close() to complete before clientStream().',
    );

    await closePromise;
  });

  it('clientStream() rejects invalid pattern format', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    expect(() => transport.clientStream('invalid-pattern')).toThrow(
      'Invalid gRPC pattern "invalid-pattern". Expected "<Service>.<Method>"',
    );

    await transport.close();
  });

  it('clientStream() supports abort via AbortSignal', async () => {
    const { transport } = createGrpcTransport();

    transport.listenClientStreaming(async (_pattern, reader) => {
      let sum = 0;

      for await (const item of reader) {
        sum += (item as { value: number }).value;
      }

      return { total: sum };
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    controller.abort();

    const { result } = transport.clientStream('MathService.StreamAll', controller.signal);

    await expect(result).rejects.toThrow('gRPC client stream aborted before dispatch.');

    await transport.close();
  });

  it('registers bidi-streaming handlers and supports interleaved read/write', async () => {
    const { transport } = createGrpcTransport();

    transport.listenBidiStreaming(async (pattern, reader, writer) => {
      for await (const item of reader) {
        const value = (item as { value: number }).value;
        writer.write({ pattern, doubled: value * 2 });
      }

      writer.end();
    });

    await transport.listen(async () => undefined);

    const { reader, writer } = transport.bidiStream('MathService.StreamBidi');
    writer.write({ value: 1 });
    writer.write({ value: 2 });
    writer.write({ value: 3 });
    writer.end();

    const results: unknown[] = [];

    for await (const item of reader) {
      results.push(item);
    }

    expect(results).toEqual([
      { pattern: 'MathService.StreamBidi', doubled: 2 },
      { pattern: 'MathService.StreamBidi', doubled: 4 },
      { pattern: 'MathService.StreamBidi', doubled: 6 },
    ]);

    await transport.close();
  });

  it('bidi-stream handler throw surfaces as an error on the client reader, not a clean EOF', async () => {
    const { transport } = createGrpcTransport();

    transport.listenBidiStreaming(async (_pattern, _reader, _writer) => {
      throw new Error('handler explosion');
    });

    await transport.listen(async () => undefined);

    const { reader, writer } = transport.bidiStream('MathService.StreamBidi');
    writer.write({ value: 1 });
    writer.end();

    const collected: unknown[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const item of reader) {
        collected.push(item);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain('handler explosion');
    expect(collected).toEqual([]);

    await transport.close();
  });

  it('bidiStream() throws when transport is not listening', () => {
    const { transport } = createGrpcTransport();

    expect(() => transport.bidiStream('MathService.StreamBidi')).toThrow(
      'GrpcMicroserviceTransport is not listening. Call listen() before bidiStream().',
    );
  });

  it('bidiStream() throws when transport is closing', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    const closePromise = transport.close();

    expect(() => transport.bidiStream('MathService.StreamBidi')).toThrow(
      'GrpcMicroserviceTransport is closing. Wait for close() to complete before bidiStream().',
    );

    await closePromise;
  });

  it('bidiStream() rejects invalid pattern format', async () => {
    const { transport } = createGrpcTransport();
    await transport.listen(async () => undefined);

    expect(() => transport.bidiStream('invalid-pattern')).toThrow(
      'Invalid gRPC pattern "invalid-pattern". Expected "<Service>.<Method>"',
    );

    await transport.close();
  });
});
