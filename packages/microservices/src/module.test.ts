import { describe, expect, it, vi } from 'vitest';

import { Inject, Scope } from '@konekti/core';
import { defineControllerMetadata, defineModuleMetadata } from '@konekti/core/internal';
import { bootstrapApplication, KonektiFactory } from '@konekti/runtime';

import { BidiStreamPattern, ClientStreamPattern, EventPattern, MessagePattern, ServerStreamPattern } from './decorators.js';
import { KafkaMicroserviceTransport } from './kafka-transport.js';
import { MicroservicesModule } from './module.js';
import { MicroserviceLifecycleService } from './service.js';
import { MICROSERVICE } from './tokens.js';
import { RedisPubSubMicroserviceTransport } from './redis-transport.js';
import { TcpMicroserviceTransport } from './tcp-transport.js';
import type {
  MicroserviceTransport,
  ServerStreamWriter,
  TransportBidiStreamHandler,
  TransportClientStreamHandler,
  TransportHandler,
  TransportServerStreamHandler,
} from './types.js';

async function* streamFrom(values: readonly unknown[]): AsyncIterable<unknown> {
  for (const value of values) {
    yield value;
  }
}

class InMemoryPubSubRedisClient {
  private static subscriptions = new Map<string, Set<InMemoryPubSubRedisClient>>();

  private readonly listeners = new Set<(channel: string, message: string) => void>();
  private readonly subscribed = new Set<string>();

  on(event: 'message', listener: (channel: string, message: string) => void): void {
    if (event === 'message') {
      this.listeners.add(listener);
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    const clients = InMemoryPubSubRedisClient.subscriptions.get(channel);

    if (!clients || clients.size === 0) {
      return 0;
    }

    for (const client of clients) {
      client.emitMessage(channel, message);
    }

    return clients.size;
  }

  async subscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      this.subscribed.add(channel);
      const bucket = InMemoryPubSubRedisClient.subscriptions.get(channel) ?? new Set<InMemoryPubSubRedisClient>();
      bucket.add(this);
      InMemoryPubSubRedisClient.subscriptions.set(channel, bucket);
    }
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      this.subscribed.delete(channel);
      const bucket = InMemoryPubSubRedisClient.subscriptions.get(channel);

      if (!bucket) {
        continue;
      }

      bucket.delete(this);

      if (bucket.size === 0) {
        InMemoryPubSubRedisClient.subscriptions.delete(channel);
      }
    }
  }

  private emitMessage(channel: string, message: string): void {
    for (const listener of this.listeners) {
      listener(channel, message);
    }
  }
}

class InMemoryKafkaBus {
  private readonly listeners = new Map<string, Set<(message: string) => Promise<void> | void>>();

  async publish(topic: string, message: string): Promise<void> {
    const handlers = this.listeners.get(topic);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      await handler(message);
    }
  }

  async subscribe(topic: string, handler: (message: string) => Promise<void> | void): Promise<void> {
    const handlers = this.listeners.get(topic) ?? new Set<(message: string) => Promise<void> | void>();
    handlers.add(handler);
    this.listeners.set(topic, handlers);
  }

  async unsubscribe(topic: string): Promise<void> {
    this.listeners.delete(topic);
  }
}

class InMemoryLoopbackTransport implements MicroserviceTransport {
  private bidiStreamHandler: TransportBidiStreamHandler | undefined;
  private clientStreamHandler: TransportClientStreamHandler | undefined;
  private handler: TransportHandler | undefined;
  private serverStreamHandler: TransportServerStreamHandler | undefined;

  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;
  }

  listenServerStreaming(handler: TransportServerStreamHandler): void {
    this.serverStreamHandler = handler;
  }

  listenClientStreaming(handler: TransportClientStreamHandler): void {
    this.clientStreamHandler = handler;
  }

  listenBidiStreaming(handler: TransportBidiStreamHandler): void {
    this.bidiStreamHandler = handler;
  }

  async send(pattern: string, payload: unknown): Promise<unknown> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    return await this.handler({ kind: 'message', pattern, payload });
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    await this.handler({ kind: 'event', pattern, payload });
  }

  async dispatchServerStream(pattern: string, payload: unknown, writer: ServerStreamWriter): Promise<void> {
    if (!this.serverStreamHandler) {
      throw new Error('Server stream handler is not listening.');
    }

    await this.serverStreamHandler(pattern, payload, writer);
  }

  async dispatchClientStream(pattern: string, values: readonly unknown[]): Promise<unknown> {
    if (!this.clientStreamHandler) {
      throw new Error('Client stream handler is not listening.');
    }

    return await this.clientStreamHandler(pattern, streamFrom(values));
  }

  async dispatchBidiStream(
    pattern: string,
    values: readonly unknown[],
    writer: ServerStreamWriter,
  ): Promise<void> {
    if (!this.bidiStreamHandler) {
      throw new Error('Bidi stream handler is not listening.');
    }

    await this.bidiStreamHandler(pattern, streamFrom(values), writer);
  }

  async close(): Promise<void> {
    this.bidiStreamHandler = undefined;
    this.clientStreamHandler = undefined;
    this.handler = undefined;
    this.serverStreamHandler = undefined;
  }
}

describe('@konekti/microservices', () => {
  it('supports createMicroservice with message and event handlers', async () => {
    class Store {
      createdEvents: string[] = [];
    }

    @Inject([Store])
    class UserHandlers {
      constructor(private readonly store: Store) {}

      @MessagePattern('user.create')
      createUser(input: { name: string }) {
        return { id: `${input.name}-id` };
      }

      @EventPattern(/^user\./)
      onUserEvent(input: { name: string }) {
        this.store.createdEvents.push(input.name);
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [Store, UserHandlers],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, {
    });

    await microservice.listen();
    const response = await microservice.send('user.create', { name: 'ayden' });
    await microservice.emit('user.created', { name: 'ayden' });

    const store = await microservice.get(Store);
    expect(response).toEqual({ id: 'ayden-id' });
    expect(store.createdEvents).toEqual(['ayden']);

    await microservice.close();
  });

  it('resolves MicroserviceLifecycleService directly and keeps MICROSERVICE as a compatibility alias', async () => {
    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const microserviceByClass = await app.container.resolve(MicroserviceLifecycleService);
    const microserviceByToken = await app.container.resolve(MICROSERVICE);

    expect(microserviceByClass).toBeInstanceOf(MicroserviceLifecycleService);
    expect(typeof microserviceByToken.listen).toBe('function');
    expect(typeof microserviceByToken.close).toBe('function');
    expect(typeof microserviceByToken.send).toBe('function');
    expect(typeof microserviceByToken.emit).toBe('function');

    await app.close();
  });

  it('handles TCP transport send and receive', async () => {
    const port = 39001;
    const transport = new TcpMicroserviceTransport({ port });

    class Handler {
      @MessagePattern('math.sum')
      sum(input: { a: number; b: number }) {
        return input.a + input.b;
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [Handler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const microservice = await app.container.resolve<{ listen(): Promise<void>; send(pattern: string, payload: unknown): Promise<unknown>; close(): Promise<void> }>(MICROSERVICE);

    await microservice.listen();
    await expect(microservice.send('math.sum', { a: 3, b: 4 })).resolves.toBe(7);

    await app.close();
  });

  it('handles Kafka transport request/reply and event dispatch', async () => {
    const bus = new InMemoryKafkaBus();
    const transport = new KafkaMicroserviceTransport({
      consumer: {
        subscribe: async (topic, handler) => {
          await bus.subscribe(topic, handler);
        },
        unsubscribe: async (topic) => {
          await bus.unsubscribe(topic);
        },
      },
      producer: {
        publish: async (topic, message) => {
          await bus.publish(topic, message);
        },
      },
      requestTimeoutMs: 1_000,
      responseTopic: 'konekti.microservices.responses.test-module',
    });

    class Store {
      events: string[] = [];
    }

    @Inject([Store])
    class Handler {
      constructor(private readonly store: Store) {}

      @MessagePattern('math.sum')
      sum(input: { a: number; b: number }) {
        return input.a + input.b;
      }

      @EventPattern(/^audit\./)
      onAudit(input: { message: string }) {
        this.store.events.push(input.message);
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [Store, Handler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);

    await microservice.listen();

    await expect(microservice.send('math.sum', { a: 5, b: 7 })).resolves.toBe(12);
    await microservice.emit('audit.login', { message: 'ok' });

    const store = await microservice.get(Store);
    expect(store.events).toEqual(['ok']);

    await microservice.close();
  });

  it('handles Redis pubsub transport publish/subscribe and regex pattern matching', async () => {
    const publishClient = new InMemoryPubSubRedisClient();
    const subscribeClient = new InMemoryPubSubRedisClient();
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    class Store {
      events: string[] = [];
    }

    @Inject([Store])
    class Handler {
      constructor(private readonly store: Store) {}

      @EventPattern(/^audit\./)
      onAudit(input: { message: string }) {
        this.store.events.push(input.message);
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [Store, Handler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);

    await microservice.listen();

    await expect(microservice.send('calc.double', { value: 21 })).rejects.toThrow(
      'RedisPubSubMicroserviceTransport does not support request/reply send().',
    );
    await microservice.emit('audit.login', { message: 'ok' });

    const store = await microservice.get(Store);
    expect(store.events).toEqual(['ok']);

    await microservice.close();
  });

  it('discovers controller handlers and supports global regex patterns repeatedly', async () => {
    class Store {
      count = 0;
      message = '';
    }

    @Inject([Store])
    class ControllerLikeHandler {
      constructor(private readonly store: Store) {}

      @EventPattern(/^audit\./g)
      onAuditEvent(input: { message: string }) {
        this.store.count += 1;
        this.store.message = input.message;
      }
    }

    defineControllerMetadata(ControllerLikeHandler, { basePath: '/micro' });

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      controllers: [ControllerLikeHandler],
      providers: [Store],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, {
    });

    await microservice.listen();
    await microservice.emit('audit.login', { message: 'one' });
    await microservice.emit('audit.logout', { message: 'two' });

    const store = await microservice.get(Store);
    expect(store.count).toBe(2);
    expect(store.message).toBe('two');

    await microservice.close();
  });

  it('isolates payload mutations across event handlers and caller payloads', async () => {
    class Store {
      firstSeen = '';
      secondSeen = '';
    }

    @Inject([Store])
    class FirstHandler {
      constructor(private readonly store: Store) {}

      @EventPattern('audit.mutation')
      onAudit(input: { meta: { role: string } }) {
        this.store.firstSeen = input.meta.role;
        input.meta.role = 'changed';
      }
    }

    @Inject([Store])
    class SecondHandler {
      constructor(private readonly store: Store) {}

      @EventPattern('audit.mutation')
      onAudit(input: { meta: { role: string } }) {
        this.store.secondSeen = input.meta.role;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [Store, FirstHandler, SecondHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, {
    });
    const payload = { meta: { role: 'original' } };

    await microservice.listen();
    await microservice.emit('audit.mutation', payload);

    const store = await microservice.get(Store);
    expect(store.firstSeen).toBe('original');
    expect(store.secondSeen).toBe('original');
    expect(payload.meta.role).toBe('original');

    await microservice.close();
  });

  it('shares singleton provider state in hybrid app + microservice composition', async () => {
    class SharedState {
      count = 0;
    }

    @Inject([SharedState])
    class HybridHandlers {
      constructor(private readonly state: SharedState) {}

      @EventPattern('hybrid.event')
      onHybridEvent() {
        this.state.count += 1;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [SharedState, HybridHandlers],
    });

    const app = await KonektiFactory.create(AppModule, {
    });
    const microservice = await app.container.resolve<{
      emit(pattern: string, payload: unknown): Promise<void>;
      listen(): Promise<void>;
    }>(MICROSERVICE);

    await Promise.all([app.listen(), microservice.listen()]);
    await microservice.emit('hybrid.event', {});

    const state = await app.container.resolve(SharedState);
    expect(state.count).toBe(1);

    await app.close();
  });

  it('deduplicates concurrent listen() calls against the underlying transport subscription', async () => {
    let listenCalls = 0;

    const transport: MicroserviceTransport = {
      async close() {},
      async emit() {},
      async listen(_handler) {
        listenCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
      async send() {
        return undefined;
      },
    };

    class Handler {
      @EventPattern('listen.once')
      onEvent() {}
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [Handler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);

    await Promise.all([microservice.listen(), microservice.listen()]);

    expect(listenCalls).toBe(1);

    await microservice.close();
  });

  it('fails deterministically when multiple message handlers match the same pattern', async () => {
    class ExactHandler {
      @MessagePattern('user.lookup')
      handle() {
        return 'exact';
      }
    }

    class RegexHandler {
      @MessagePattern(/^user\./)
      handle() {
        return 'regex';
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [ExactHandler, RegexHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await expect(microservice.send('user.lookup', {})).rejects.toThrow('Multiple message handlers matched pattern "user.lookup"');

    await microservice.close();
  });

  it('creates an isolated request scope per @MessagePattern invocation', async () => {
    let created = 0;

    @Scope('request')
    class RequestState {
      readonly id = ++created;
    }

    @Inject([RequestState])
    @Scope('request')
    class RequestScopedHandler {
      constructor(private readonly state: RequestState) {}

      @MessagePattern('scope.id')
      getId() {
        return this.state.id;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [RequestState, RequestScopedHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    const [first, second] = await Promise.all([
      microservice.send('scope.id', {}),
      microservice.send('scope.id', {}),
    ]);

    expect(first).not.toBe(second);
    expect(first).toBeTypeOf('number');
    expect(second).toBeTypeOf('number');

    await microservice.close();
  });

  it('disposes request-scoped providers after each message completes', async () => {
    const destroyed: number[] = [];

    @Scope('request')
    class RequestState {
      constructor(public readonly id = destroyed.length + 1) {}

      onDestroy(): void {
        destroyed.push(this.id);
      }
    }

    @Inject([RequestState])
    @Scope('request')
    class RequestScopedHandler {
      constructor(private readonly state: RequestState) {}

      @MessagePattern('scope.dispose')
      getId() {
        return this.state.id;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [RequestState, RequestScopedHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await expect(microservice.send('scope.dispose', {})).resolves.toBe(1);
    await expect(microservice.send('scope.dispose', {})).resolves.toBe(2);
    expect(destroyed).toEqual([1, 2]);

    await microservice.close();
  });

  it('disposes request-scoped providers after handler errors', async () => {
    const onDestroy = vi.fn();

    @Scope('request')
    class RequestState {
      onDestroy(): void {
        onDestroy();
      }
    }

    @Inject([RequestState])
    @Scope('request')
    class RequestScopedHandler {
      constructor(private readonly state: RequestState) {}

      @MessagePattern('scope.error')
      fail() {
        void this.state;
        throw new Error('request handler failed');
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [RequestState, RequestScopedHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await expect(microservice.send('scope.error', {})).rejects.toThrow('request handler failed');
    expect(onDestroy).toHaveBeenCalledTimes(1);

    await microservice.close();
  });

  it('rejects send() when a matched singleton handler method is not callable', async () => {
    class BrokenHandler {
      @MessagePattern('broken.handler')
      handle() {
        return 'ok';
      }
    }

    Object.defineProperty(BrokenHandler.prototype, 'handle', {
      configurable: true,
      value: 'not-a-function',
      writable: true,
    });

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [BrokenHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await expect(microservice.send('broken.handler', {})).rejects.toThrow(/must be a callable function/i);

    await microservice.close();
  });

  it('supports request-scoped @EventPattern handlers with per-event scope isolation', async () => {
    const createdIds: number[] = [];
    let nextId = 0;

    @Scope('request')
    class EventContext {
      readonly id = ++nextId;

      constructor() {
        createdIds.push(this.id);
      }
    }

    @Inject([EventContext])
    @Scope('request')
    class RequestScopedEventHandler {
      constructor(private readonly ctx: EventContext) {}

      @EventPattern('scope.event')
      onEvent(_input: unknown) {
        return this.ctx.id;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [EventContext, RequestScopedEventHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await microservice.emit('scope.event', { id: 1 });
    await microservice.emit('scope.event', { id: 2 });

    expect(createdIds).toHaveLength(2);
    expect(createdIds[0]).not.toBe(createdIds[1]);

    await microservice.close();
  });

  it('shares per-event scope across multiple matching fan-out handlers', async () => {
    const scopeIds: Array<{ handler: string; scopeId: number }> = [];

    @Scope('request')
    class SharedScope {
      static counter = 0;
      readonly id = ++SharedScope.counter;
    }

    @Inject([SharedScope])
    @Scope('request')
    class FirstEventHandler {
      constructor(private readonly scope: SharedScope) {}

      @EventPattern('fanout.event')
      onEvent() {
        scopeIds.push({ handler: 'first', scopeId: this.scope.id });
      }
    }

    @Inject([SharedScope])
    @Scope('request')
    class SecondEventHandler {
      constructor(private readonly scope: SharedScope) {}

      @EventPattern('fanout.event')
      onEvent() {
        scopeIds.push({ handler: 'second', scopeId: this.scope.id });
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [SharedScope, FirstEventHandler, SecondEventHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await microservice.emit('fanout.event', {});

    expect(scopeIds).toHaveLength(2);
    expect(scopeIds[0].scopeId).toBe(scopeIds[1].scopeId);

    await microservice.close();
  });

  it('disposes per-event scope after fan-out completes', async () => {
    const disposed: number[] = [];

    @Scope('request')
    class DisposableContext {
      static counter = 0;
      readonly id = ++DisposableContext.counter;

      onDestroy(): void {
        disposed.push(this.id);
      }
    }

    @Inject([DisposableContext])
    @Scope('request')
    class DisposableHandler {
      constructor(private readonly ctx: DisposableContext) {}

      @EventPattern('dispose.event')
      onEvent() {
        return this.ctx.id;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [DisposableContext, DisposableHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await microservice.emit('dispose.event', {});
    await microservice.emit('dispose.event', {});

    expect(disposed).toHaveLength(2);
    expect(disposed[0]).not.toBe(disposed[1]);

    await microservice.close();
  });

  it('disposes per-event scope even when handler throws', async () => {
    const disposed: number[] = [];

    @Scope('request')
    class DisposableContext {
      static counter = 0;
      readonly id = ++DisposableContext.counter;

      onDestroy(): void {
        disposed.push(this.id);
      }
    }

    @Inject([DisposableContext])
    @Scope('request')
    class FailingHandler {
      constructor(private readonly ctx: DisposableContext) {}

      @EventPattern('fail.event')
      onEvent() {
        void this.ctx;
        throw new Error('handler failed');
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [DisposableContext, FailingHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await microservice.emit('fail.event', {});

    expect(disposed).toHaveLength(1);

    await microservice.close();
  });

  it('supports transient-scoped @EventPattern handlers', async () => {
    const instanceIds: number[] = [];
    let nextId = 0;

    @Scope('transient')
    class TransientHandler {
      readonly id = ++nextId;

      @EventPattern('transient.event')
      onEvent() {
        instanceIds.push(this.id);
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [TransientHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await microservice.emit('transient.event', {});
    await microservice.emit('transient.event', {});

    expect(instanceIds).toHaveLength(2);
    expect(instanceIds[0]).not.toBe(instanceIds[1]);

    await microservice.close();
  });

  it('disposes request-scoped providers after server-stream handler completes normally', async () => {
    const disposed: number[] = [];

    @Scope('request')
    class StreamContext {
      static counter = 0;
      readonly id = ++StreamContext.counter;

      onDestroy(): void {
        disposed.push(this.id);
      }
    }

    @Inject([StreamContext])
    @Scope('request')
    class StreamHandler {
      constructor(private readonly ctx: StreamContext) {}

      @ServerStreamPattern('stream.data')
      handle(_payload: unknown, writer: ServerStreamWriter) {
        writer.write({ scopeId: this.ctx.id });
        writer.end();
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [StreamContext, StreamHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    const written: unknown[] = [];
    const writer: ServerStreamWriter = {
      write(data) { written.push(data); },
      end() {},
      error() {},
    };

    await transport.dispatchServerStream('stream.data', {}, writer);
    await transport.dispatchServerStream('stream.data', {}, writer);

    expect(written).toEqual([{ scopeId: 1 }, { scopeId: 2 }]);
    expect(disposed).toEqual([1, 2]);

    await microservice.close();
  });

  it('disposes request-scoped providers after server-stream handler throws', async () => {
    const onDestroy = vi.fn();

    @Scope('request')
    class StreamContext {
      onDestroy(): void {
        onDestroy();
      }
    }

    @Inject([StreamContext])
    @Scope('request')
    class FailingStreamHandler {
      constructor(private readonly ctx: StreamContext) {}

      @ServerStreamPattern('stream.fail')
      handle() {
        void this.ctx;
        throw new Error('stream handler failed');
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [StreamContext, FailingStreamHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    let receivedError: Error | undefined;
    const writer: ServerStreamWriter = {
      write() {},
      end() {},
      error(err) { receivedError = err; },
    };

    await transport.dispatchServerStream('stream.fail', {}, writer);

    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(receivedError?.message).toBe('stream handler failed');

    await microservice.close();
  });

  it('creates an isolated request scope per @ServerStreamPattern invocation', async () => {
    let created = 0;

    @Scope('request')
    class StreamState {
      readonly id = ++created;
    }

    @Inject([StreamState])
    @Scope('request')
    class ScopedStreamHandler {
      constructor(private readonly state: StreamState) {}

      @ServerStreamPattern('stream.scope')
      handle(_payload: unknown, writer: ServerStreamWriter) {
        writer.write({ scopeId: this.state.id });
        writer.end();
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [StreamState, ScopedStreamHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    const firstWritten: unknown[] = [];
    const secondWritten: unknown[] = [];

    await transport.dispatchServerStream('stream.scope', {}, {
      write(data) { firstWritten.push(data); },
      end() {},
      error() {},
    });

    await transport.dispatchServerStream('stream.scope', {}, {
      write(data) { secondWritten.push(data); },
      end() {},
      error() {},
    });

    expect(firstWritten).toEqual([{ scopeId: 1 }]);
    expect(secondWritten).toEqual([{ scopeId: 2 }]);
    expect(created).toBe(2);

    await microservice.close();
  });

  it('disposes request-scoped providers after client-stream handler completes and on error', async () => {
    const disposed: number[] = [];
    const failedDisposed: number[] = [];

    @Scope('request')
    class ClientStreamContext {
      static counter = 0;
      readonly id = ++ClientStreamContext.counter;

      onDestroy(): void {
        disposed.push(this.id);
      }
    }

    @Inject([ClientStreamContext])
    @Scope('request')
    class ClientStreamHandler {
      constructor(private readonly ctx: ClientStreamContext) {}

      @ClientStreamPattern('stream.client')
      async handle(reader: AsyncIterable<unknown>) {
        let total = 0;

        for await (const item of reader) {
          total += Number((item as { value: number }).value);
        }

        return { scopeId: this.ctx.id, total };
      }
    }

    @Scope('request')
    class FailingClientStreamContext {
      onDestroy(): void {
        failedDisposed.push(1);
      }
    }

    @Inject([FailingClientStreamContext])
    @Scope('request')
    class FailingClientStreamHandler {
      constructor(private readonly ctx: FailingClientStreamContext) {}

      @ClientStreamPattern('stream.client.fail')
      async handle(_reader: AsyncIterable<unknown>) {
        void this.ctx;
        throw new Error('client stream failed');
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [
        ClientStreamContext,
        ClientStreamHandler,
        FailingClientStreamContext,
        FailingClientStreamHandler,
      ],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    await expect(transport.dispatchClientStream('stream.client', [{ value: 1 }, { value: 2 }]))
      .resolves.toEqual({ scopeId: 1, total: 3 });
    await expect(transport.dispatchClientStream('stream.client', [{ value: 3 }]))
      .resolves.toEqual({ scopeId: 2, total: 3 });
    await expect(transport.dispatchClientStream('stream.client.fail', [{ value: 99 }]))
      .rejects.toThrow('client stream failed');

    expect(disposed).toEqual([1, 2]);
    expect(failedDisposed).toHaveLength(1);

    await microservice.close();
  });

  it('disposes request-scoped providers after bidi-stream handler completes and on error', async () => {
    const disposed: number[] = [];
    const failedDisposed: number[] = [];

    @Scope('request')
    class BidiStreamContext {
      static counter = 0;
      readonly id = ++BidiStreamContext.counter;

      onDestroy(): void {
        disposed.push(this.id);
      }
    }

    @Inject([BidiStreamContext])
    @Scope('request')
    class BidiHandler {
      constructor(private readonly ctx: BidiStreamContext) {}

      @BidiStreamPattern('stream.bidi')
      async handle(reader: AsyncIterable<unknown>, writer: ServerStreamWriter) {
        for await (const item of reader) {
          writer.write({ scopeId: this.ctx.id, value: (item as { value: number }).value });
        }

        writer.end();
      }
    }

    @Scope('request')
    class FailingBidiContext {
      onDestroy(): void {
        failedDisposed.push(1);
      }
    }

    @Inject([FailingBidiContext])
    @Scope('request')
    class FailingBidiHandler {
      constructor(private readonly ctx: FailingBidiContext) {}

      @BidiStreamPattern('stream.bidi.fail')
      async handle(_reader: AsyncIterable<unknown>, _writer: ServerStreamWriter) {
        void this.ctx;
        throw new Error('bidi stream failed');
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [BidiStreamContext, BidiHandler, FailingBidiContext, FailingBidiHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule);
    await microservice.listen();

    const firstWritten: unknown[] = [];
    await transport.dispatchBidiStream('stream.bidi', [{ value: 10 }, { value: 20 }], {
      write(data) { firstWritten.push(data); },
      end() {},
      error() {},
    });

    const secondWritten: unknown[] = [];
    await transport.dispatchBidiStream('stream.bidi', [{ value: 30 }], {
      write(data) { secondWritten.push(data); },
      end() {},
      error() {},
    });

    let bidiError: Error | undefined;
    await transport.dispatchBidiStream('stream.bidi.fail', [{ value: 99 }], {
      write() {},
      end() {},
      error(err) { bidiError = err; },
    });

    expect(firstWritten).toEqual([
      { scopeId: 1, value: 10 },
      { scopeId: 1, value: 20 },
    ]);
    expect(secondWritten).toEqual([{ scopeId: 2, value: 30 }]);
    expect(disposed).toEqual([1, 2]);
    expect(failedDisposed).toHaveLength(1);
    expect(bidiError?.message).toBe('bidi stream failed');

    await microservice.close();
  });
});
