import { Inject } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Controller, Get, type HttpApplicationAdapter, UnauthorizedException } from '@fluojs/http';
import {
  type CloudflareWorkerExecutionContext,
  CloudflareWorkerHttpApplicationAdapter,
  type CloudflareWorkerWebSocketPair,
} from '@fluojs/platform-cloudflare-workers';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { createFetchStyleWebSocketConformanceHarness } from '@fluojs/testing/fetch-style-websocket-conformance';
import { describe, expect, it, vi } from 'vitest';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as workerPublicApi from './cloudflare-workers.js';
import {
  CloudflareWorkersWebSocketGatewayLifecycleService,
  CloudflareWorkersWebSocketModule,
  type CloudflareWorkerWebSocket,
  type CloudflareWorkerWebSocketBinding,
  type CloudflareWorkerWebSocketBindingHost,
  type CloudflareWorkerWebSocketMessage,
  type CloudflareWorkerWebSocketUpgradeResult,
} from './cloudflare-workers.js';

type MockSocketListenerMap = {
  close: Array<(event: Event) => void>;
  error: Array<(event: Event) => void>;
  message: Array<(event: MessageEvent<CloudflareWorkerWebSocketMessage>) => void>;
};

const WEBSOCKET_OPEN_READY_STATE = 1;
const WEBSOCKET_CLOSED_READY_STATE = 3;
const CLOUDFLARE_WORKERS_WEBSOCKET_CAPABILITY_REASON =
  'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @fluojs/websockets/cloudflare-workers for the official raw websocket binding.';

class MockWorkerSocket implements CloudflareWorkerWebSocket {
  readonly #listeners: MockSocketListenerMap = {
    close: [],
    error: [],
    message: [],
  };
  #readyState: number = WEBSOCKET_OPEN_READY_STATE;
  #closeDeliveryPromise?: Promise<void>;
  accepted = false;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly sentMessages: string[] = [];

  get readyState(): number {
    return this.#readyState;
  }

  accept(): void {
    this.accepted = true;
  }

  addEventListener(type: 'close' | 'error' | 'message', listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) {
      return;
    }

    const callback: (event: Event) => void = typeof listener === 'function'
      ? (event: Event) => listener(event)
      : (event: Event) => listener.handleEvent(event);

    if (type === 'close') {
      this.#listeners.close.push(callback);
      return;
    }

    if (type === 'error') {
      this.#listeners.error.push(callback);
      return;
    }

    this.#listeners.message.push(callback as (event: MessageEvent<CloudflareWorkerWebSocketMessage>) => void);
  }

  close(code?: number, reason?: string): void {
    this.#readyState = WEBSOCKET_CLOSED_READY_STATE;
    this.closeCalls.push({ code, reason });
    const event = new Event('close') as Event & { code: number; reason: string };
    Object.defineProperties(event, {
      code: { value: code ?? 1000 },
      reason: { value: reason ?? '' },
    });

    const dispatch = () => {
      for (const listener of this.#listeners.close) {
        listener(event);
      }
    };

    if (this.#closeDeliveryPromise) {
      void this.#closeDeliveryPromise.then(dispatch);
      return;
    }

    dispatch();
  }

  delayCloseUntil(promise: Promise<void>): void {
    this.#closeDeliveryPromise = promise;
  }

  emitError(): void {
    const event = new Event('error');

    for (const listener of this.#listeners.error) {
      listener(event);
    }
  }

  emitMessage(data: CloudflareWorkerWebSocketMessage): void {
    const event = new MessageEvent<CloudflareWorkerWebSocketMessage>('message', { data });

    for (const listener of this.#listeners.message) {
      listener(event);
    }
  }

  removeEventListener(type: 'close' | 'error' | 'message', listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) {
      return;
    }

    const callback: (event: Event) => void = typeof listener === 'function'
      ? (event: Event) => listener(event)
      : (event: Event) => listener.handleEvent(event);

    if (type === 'close') {
      this.removeCloseListener(callback);
      return;
    }

    if (type === 'error') {
      this.removeErrorListener(callback);
      return;
    }

    this.removeMessageListener(callback as (event: MessageEvent<CloudflareWorkerWebSocketMessage>) => void);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  private removeCloseListener(callback: (event: Event) => void): void {
    const index = this.#listeners.close.indexOf(callback);
    if (index >= 0) {
      this.#listeners.close.splice(index, 1);
    }
  }

  private removeErrorListener(callback: (event: Event) => void): void {
    const index = this.#listeners.error.indexOf(callback);
    if (index >= 0) {
      this.#listeners.error.splice(index, 1);
    }
  }

  private removeMessageListener(callback: (event: MessageEvent<CloudflareWorkerWebSocketMessage>) => void): void {
    const index = this.#listeners.message.indexOf(callback);
    if (index >= 0) {
      this.#listeners.message.splice(index, 1);
    }
  }
}

class TestWorkerServer {
  lastSocket?: MockWorkerSocket;

  constructor(private readonly binding?: CloudflareWorkerWebSocketBinding) {}

  async fetch(request: Request): Promise<Response> {
    if (!this.binding) {
      return new Response(null, { status: 404 });
    }

    return await this.binding.fetch(request, {
      upgrade: () => this.upgrade(),
    });
  }

  upgrade(): CloudflareWorkerWebSocketUpgradeResult {
    new MockWorkerSocket();
    const serverSocket = new MockWorkerSocket();
    this.lastSocket = serverSocket;

    return {
      response: new Response(null, { status: 200 }),
      serverSocket,
    };
  }
}

class TestWorkerAdapter implements HttpApplicationAdapter, CloudflareWorkerWebSocketBindingHost {
  private binding?: CloudflareWorkerWebSocketBinding;
  private server?: TestWorkerServer;

  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void {
    this.binding = binding;
  }

  getRealtimeCapability() {
    return {
      contract: 'raw-websocket-expansion' as const,
      kind: 'fetch-style' as const,
      mode: 'request-upgrade' as const,
      reason: CLOUDFLARE_WORKERS_WEBSOCKET_CAPABILITY_REASON,
      support: 'supported' as const,
      version: 1 as const,
    };
  }

  getServer(): TestWorkerServer | undefined {
    return this.server;
  }

  async listen(): Promise<void> {
    this.server = new TestWorkerServer(this.binding);
  }

  async close(): Promise<void> {
    this.server = undefined;
  }
}

async function settleMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}


function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createExecutionContext(): CloudflareWorkerExecutionContext {
  return {
    waitUntil() {},
  };
}

function createWebSocketPairStub() {
  return vi.fn<() => CloudflareWorkerWebSocketPair>(() => ({
    0: new MockWorkerSocket(),
    1: new MockWorkerSocket(),
  }));
}

describe('@fluojs/websockets/cloudflare-workers', () => {
  it('exposes the explicit Cloudflare Workers websocket seam', () => {
    expect(workerPublicApi).toHaveProperty('CloudflareWorkersWebSocketModule');
    expect(workerPublicApi).toHaveProperty('CloudflareWorkersWebSocketGatewayLifecycleService');
    expect(workerPublicApi).not.toHaveProperty('createCloudflareWorkersWebSocketProviders');
  });

  it('wires the Cloudflare Workers lifecycle service through Worker-only providers', () => {
    const options = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = getModuleMetadata(CloudflareWorkersWebSocketModule.forRoot(options))?.providers ?? [];
    const optionsProvider = providers.find(
      (provider: unknown) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(CloudflareWorkersWebSocketGatewayLifecycleService);
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('reports the supported fetch-style websocket contract through the conformance harness', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => new TestWorkerAdapter(),
      expectedReason: CLOUDFLARE_WORKERS_WEBSOCKET_CAPABILITY_REASON,
      expectedSupport: 'supported',
      name: 'websockets cloudflare-workers test adapter',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('rejects serverBacked gateway opt-in on the Cloudflare Workers fetch-style binding', async () => {
    const adapter = new TestWorkerAdapter();

    @WebSocketGateway({ path: '/chat', serverBacked: { port: 4103 } })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    await expect(
      bootstrapApplication({
        adapter,
        rootModule: AppModule,
      }),
    ).rejects.toThrow('@WebSocketGateway({ serverBacked }) is not supported on @fluojs/websockets/cloudflare-workers');
  });

  it('preserves Worker-backed websocket behavior through the explicit cloudflare-workers seam', async () => {
    const adapter = new TestWorkerAdapter();

    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        this.state.connectCount += 1;
      }

      @OnMessage('ping')
      onPing(payload: unknown, socket: CloudflareWorkerWebSocket) {
        this.state.messages.push(payload);
        socket.send(JSON.stringify({ event: 'pong', data: payload }));
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot()],
      providers: [GatewayState, ChatGateway],
    });

    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const state = await app.container.resolve<GatewayState>(GatewayState);

    try {
      await app.listen();

      const server = adapter.getServer();
      const upgradeResponse = await server?.fetch(new Request('https://worker.test/chat', {
        headers: { upgrade: 'websocket' },
      }));

      await settleMicrotasks();

      const socket = server?.lastSocket;
      expect(upgradeResponse?.status).toBe(200);
      expect(socket).toBeDefined();
      expect(socket?.accepted).toBe(true);

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      try {
        socket.emitMessage('{"event":"ping","data":{"value":"hello"}}');
        await settleMicrotasks();

        socket.close(1000, 'done');
        await settleMicrotasks();

        expect(state.connectCount).toBe(1);
        expect(state.messages).toEqual([{ value: 'hello' }]);
        expect(socket.sentMessages).toEqual(['{"event":"pong","data":{"value":"hello"}}']);
        expect(state.disconnectCount).toBe(1);
      } finally {
        if (socket.readyState === WEBSOCKET_OPEN_READY_STATE) {
          socket.close(1000, 'test cleanup');
        }
      }
    } finally {
      await app.close();
    }
  });

  it('manages rooms and rejects stale joins through the Worker lifecycle service', async () => {
    const adapter = new TestWorkerAdapter();

    @WebSocketGateway({ path: '/rooms' })
    class RoomGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot()],
      providers: [RoomGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const service = await app.container.resolve<CloudflareWorkersWebSocketGatewayLifecycleService>(
      CloudflareWorkersWebSocketGatewayLifecycleService,
    );
    service.joinRoom('socket-unknown', 'room-stale');
    expect(Array.from(service.getRooms('socket-unknown'))).toEqual([]);

    try {
      await app.listen();
      const server = adapter.getServer();
      const upgradeResponse = await server?.fetch(new Request('https://worker.test/rooms', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;
      const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, CloudflareWorkerWebSocket>;
      const socketId = socketRegistry.keys().next().value;
      expect(upgradeResponse?.status).toBe(200);

      if (!socket || typeof socketId !== 'string') {
        throw new Error('Expected Worker room test socket registration after websocket upgrade.');
      }

      service.joinRoom(socketId, 'room-a');
      service.joinRoom(socketId, 'room-b');

      expect(Array.from(service.getRooms(socketId)).sort()).toEqual(['room-a', 'room-b']);

      service.broadcastToRoom('room-a', 'order.updated', { orderId: 'ord_workers' });
      service.leaveRoom(socketId, 'room-a');
      service.broadcastToRoom('room-a', 'order.updated', { orderId: 'ord_after_leave' });

      expect(socket.sentMessages).toEqual([
        JSON.stringify({ data: { orderId: 'ord_workers' }, event: 'order.updated' }),
      ]);
      expect(Array.from(service.getRooms(socketId))).toEqual(['room-b']);

      const closeDelivery = createDeferred<void>();
      socket.delayCloseUntil(closeDelivery.promise);
      socket.close(1000, 'done');
      service.joinRoom(socketId, 'room-stale');
      const roomsWhileCloseDeliveryIsPending = Array.from(service.getRooms(socketId));
      closeDelivery.resolve();
      await settleMicrotasks();
      service.joinRoom(socketId, 'room-stale');

      expect(roomsWhileCloseDeliveryIsPending).toEqual(['room-b']);
      expect(Array.from(service.getRooms(socketId))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['true', (): true => true, 200],
    ['undefined', (): undefined => undefined, 200],
    ['no return value', (): void => {}, 200],
    ['false', (): false => false, 403],
  ] as const)('maps a Worker guard %s outcome to the documented upgrade decision', async (_outcome, guard, expectedStatus) => {
    const adapter = new TestWorkerAdapter();

    @WebSocketGateway({ path: '/guard-outcome' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ upgrade: { guard } })],
      providers: [GuardedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    try {
      await app.listen();

      const server = adapter.getServer();
      const response = await server?.fetch(new Request('https://worker.test/guard-outcome', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      expect(response?.status).toBe(expectedStatus);
      expect(server?.lastSocket !== undefined).toBe(expectedStatus === 200);
    } finally {
      await app.close();
    }
  });

  it('rejects anonymous upgrade requests before the Worker websocket upgrade completes', async () => {
    const adapter = new TestWorkerAdapter();

    @WebSocketGateway({ path: '/guarded' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        upgrade: {
          guard(request) {
            return request instanceof Request && request.headers.get('authorization') === 'Bearer workers'
              ? true
              : { body: 'Authentication required.', status: 401 };
          },
        },
      })],
      providers: [GuardedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    try {
      await app.listen();

      const response = await adapter.getServer()?.fetch(new Request('https://worker.test/guarded', {
        headers: { upgrade: 'websocket' },
      }));

      expect(response?.status).toBe(401);
      expect(await response?.text()).toBe('Authentication required.');
    } finally {
      await app.close();
    }
  });

  it('maps thrown Worker guard exceptions to rejected websocket upgrades', async () => {
    const adapter = new TestWorkerAdapter();

    @WebSocketGateway({ path: '/thrown-guard' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        upgrade: {
          guard() {
            throw new UnauthorizedException('Authentication required.');
          },
        },
      })],
      providers: [GuardedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    try {
      await app.listen();

      const response = await adapter.getServer()?.fetch(new Request('https://worker.test/thrown-guard', {
        headers: { upgrade: 'websocket' },
      }));

      expect(response?.status).toBe(401);
      expect(await response?.text()).toBe('Authentication required.');
    } finally {
      await app.close();
    }
  });

  it('awaits raw Worker handler return promises before ignoring returned values', async () => {
    const adapter = new TestWorkerAdapter();
    const handlerGate = createDeferred<void>();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/ignored-return' })
    class ReturnOnlyGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('first')
      async onFirst(payload: unknown) {
        await handlerGate.promise;
        this.state.messages.push(payload);
        return { event: 'pong', data: payload };
      }

      @OnMessage('second')
      onSecond(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot()],
      providers: [GatewayState, ReturnOnlyGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);

    try {
      await app.listen();

      const server = adapter.getServer();
      const upgradeResponse = await server?.fetch(new Request('https://worker.test/ignored-return', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;
      expect(upgradeResponse?.status).toBe(200);
      expect(socket).toBeDefined();
      expect(socket?.accepted).toBe(true);

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.emitMessage('{"event":"first","data":{"value":"ignored"}}');
      socket.emitMessage('{"event":"second","data":{"value":"after"}}');
      await settleMicrotasks();

      expect(state.messages).toEqual([]);
      expect(socket.sentMessages).toEqual([]);

      handlerGate.resolve();
      await settleMicrotasks();

      expect(state.messages).toEqual([{ value: 'ignored' }, { value: 'after' }]);
      expect(socket.sentMessages).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('rejects Worker upgrades that exceed the configured connection limit', async () => {
    const adapter = new TestWorkerAdapter();

    @WebSocketGateway({ path: '/limited' })
    class LimitedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxConnections: 1,
        },
      })],
      providers: [LimitedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    try {
      await app.listen();

      const server = adapter.getServer();
      const firstUpgrade = await server?.fetch(new Request('https://worker.test/limited', {
        headers: { upgrade: 'websocket' },
      }));
      const secondUpgrade = await server?.fetch(new Request('https://worker.test/limited', {
        headers: { upgrade: 'websocket' },
      }));

      expect(firstUpgrade?.status).toBe(200);
      expect(secondUpgrade?.status).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('rejects concurrent Worker upgrades once one pending upgrade already reserved the last slot', async () => {
    const adapter = new TestWorkerAdapter();
    const guardGate = createDeferred<void>();

    @WebSocketGateway({ path: '/limited-race' })
    class LimitedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxConnections: 1,
        },
        upgrade: {
          async guard() {
            await guardGate.promise;
            return true;
          },
        },
      })],
      providers: [LimitedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();

    const server = adapter.getServer();
    const firstUpgradePromise = server?.fetch(new Request('https://worker.test/limited-race', {
      headers: { upgrade: 'websocket' },
    }));

    await settleMicrotasks();

    const secondUpgrade = await server?.fetch(new Request('https://worker.test/limited-race', {
      headers: { upgrade: 'websocket' },
    }));

    expect(secondUpgrade?.status).toBe(429);

    guardGate.resolve();

    expect((await firstUpgradePromise)?.status).toBe(200);

    await app.close();
  });

  it('rejects in-flight Worker upgrades once shutdown begins during an async guard', async () => {
    const adapter = new TestWorkerAdapter();
    const guardGate = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown-guard-race' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        upgrade: {
          async guard() {
            await guardGate.promise;
            return true;
          },
        },
      })],
      providers: [GuardedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();

    const server = adapter.getServer();
    const upgradePromise = server?.fetch(new Request('https://worker.test/shutdown-guard-race', {
      headers: { upgrade: 'websocket' },
    }));

    await settleMicrotasks();

    const closePromise = app.close();

    guardGate.resolve();

    const response = await upgradePromise;

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Server is shutting down.',
        status: 503,
      },
    });
    expect(server?.lastSocket).toBeUndefined();

    await closePromise;
  });

  it('keeps real Worker adapter websocket upgrades on shutdown JSON during application shutdown', async () => {
    const createWebSocketPair = createWebSocketPairStub();
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair,
    });
    const disconnectStarted = createDeferred<void>();
    const releaseDisconnect = createDeferred<void>();
    let httpDispatchCalls = 0;

    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnDisconnect()
      async onDisconnect() {
        disconnectStarted.resolve();
        await releaseDisconnect.promise;
      }
    }

    @Controller('/chat')
    class ChatFallbackController {
      @Get('/')
      getChatFallback() {
        httpDispatchCalls += 1;
        return { fallback: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ChatFallbackController],
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [ChatGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    let closePromise: Promise<void> | undefined;

    try {
      await app.listen();

      const acceptedResponse = await adapter.fetch(
        new Request('https://worker.test/chat', {
          headers: { upgrade: 'websocket' },
        }),
        {},
        createExecutionContext(),
      );

      expect(acceptedResponse.status).toBe(101);

      closePromise = app.close();
      await disconnectStarted.promise;

      const shutdownResponse = await adapter.fetch(
        new Request('https://worker.test/chat', {
          headers: { upgrade: 'websocket' },
        }),
        {},
        createExecutionContext(),
      );

      expect(shutdownResponse.status).toBe(503);
      await expect(shutdownResponse.json()).resolves.toMatchObject({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server is shutting down.',
          status: 503,
        },
      });
      expect(httpDispatchCalls).toBe(0);
      expect(createWebSocketPair).toHaveBeenCalledTimes(1);
    } finally {
      releaseDisconnect.resolve();
      await closePromise;
      await app.close();
    }
  });

  it('closes Worker sockets and runs disconnect cleanup during application shutdown', async () => {
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred<void>();

    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/shutdown' })
    class ShutdownGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        this.state.connectCount += 1;
        connected.resolve();
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        shutdown: { timeoutMs: 200 },
      })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    const service = await app.container.resolve(CloudflareWorkersWebSocketGatewayLifecycleService);
    await app.listen();

    const server = adapter.getServer();
    const upgradeResponse = await server?.fetch(new Request('https://worker.test/shutdown', {
      headers: { upgrade: 'websocket' },
    }));

    await settleMicrotasks();

    const socket = server?.lastSocket;
    expect(upgradeResponse?.status).toBe(200);

    if (!socket) {
      throw new Error('Expected Worker test socket to be available after websocket upgrade.');
    }

    await connected.promise;
    await app.close();
    await settleMicrotasks();

    expect(socket.readyState).toBe(WEBSOCKET_CLOSED_READY_STATE);
    expect(state.connectCount).toBe(1);
    expect(state.disconnectCount).toBe(1);
    expect((Reflect.get(service, 'socketRegistry') as Map<string, MockWorkerSocket>).size).toBe(0);
  });

  it('waits for asynchronously delivered Worker close events during shutdown', async () => {
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred<void>();
    const closeGate = createDeferred<void>();

    class GatewayState {
      disconnectCount = 0;
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/shutdown-async-close' })
    class ShutdownGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        connected.resolve();
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/shutdown-async-close', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    const socket = server?.lastSocket;

    if (!socket) {
      throw new Error('Expected Worker test socket to be available after websocket upgrade.');
    }

    await connected.promise;
    socket.delayCloseUntil(closeGate.promise);

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await settleMicrotasks();

    expect(closed).toBe(false);
    expect(state.disconnectCount).toBe(0);

    closeGate.resolve();
    await closePromise;

    expect(state.disconnectCount).toBe(1);
  });

  it('waits for asynchronous Worker disconnect cleanup before finishing shutdown', async () => {
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred<void>();
    const disconnectGate = createDeferred<void>();

    class GatewayState {
      disconnectCount = 0;
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/shutdown-async-disconnect' })
    class ShutdownGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        connected.resolve();
      }

      @OnDisconnect()
      async onDisconnect() {
        await disconnectGate.promise;
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/shutdown-async-disconnect', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    await connected.promise;

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await settleMicrotasks();

    expect(closed).toBe(false);
    expect(state.disconnectCount).toBe(0);

    disconnectGate.resolve();
    await closePromise;

    expect(state.disconnectCount).toBe(1);
  });

  it('waits for Worker disconnect cleanup already queued when shutdown starts', async () => {
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred<void>();
    const disconnectStarted = createDeferred<void>();
    const disconnectRelease = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown-queued-disconnect' })
    class ShutdownGateway {
      @OnConnect()
      onConnect() {
        connected.resolve();
      }

      @OnDisconnect()
      async onDisconnect() {
        disconnectStarted.resolve();
        await disconnectRelease.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      await app.listen();
      const server = adapter.getServer();

      await server?.fetch(new Request('https://worker.test/shutdown-queued-disconnect', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();
      await connected.promise;

      const socket = server?.lastSocket;

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.close(1000, 'Client closed');
      await disconnectStarted.promise;

      let closed = false;
      const closePromise = app.close().then(() => {
        closed = true;
      });

      await settleMicrotasks();

      expect(closed).toBe(false);

      disconnectRelease.resolve();
      await closePromise;
    } finally {
      disconnectRelease.resolve();
      await app.close();
    }
  });

  it('waits for Worker disconnect cleanup queued after a room broadcast send failure', async () => {
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred<void>();
    const disconnectStarted = createDeferred<void>();
    const disconnectRelease = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown-broadcast-failure' })
    class ShutdownGateway {
      @OnConnect()
      onConnect() {
        connected.resolve();
      }

      @OnDisconnect()
      async onDisconnect() {
        disconnectStarted.resolve();
        await disconnectRelease.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const service = await app.container.resolve<CloudflareWorkersWebSocketGatewayLifecycleService>(
      CloudflareWorkersWebSocketGatewayLifecycleService,
    );
    let closePromise: Promise<void> | undefined;

    try {
      await app.listen();
      const server = adapter.getServer();

      await server?.fetch(new Request('https://worker.test/shutdown-broadcast-failure', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();
      await connected.promise;

      const socket = server?.lastSocket;
      const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, CloudflareWorkerWebSocket>;
      const socketId = socketRegistry.keys().next().value;

      if (!socket || typeof socketId !== 'string') {
        throw new Error('Expected Worker broadcast failure test socket registration after websocket upgrade.');
      }

      service.joinRoom(socketId, 'shutdown-room');
      socket.send = () => {
        throw new Error('Broadcast failed.');
      };

      // When
      service.broadcastToRoom('shutdown-room', 'shutdown.test', undefined);

      // Then
      expect(socket.closeCalls).toEqual([{ code: 1011, reason: 'Send failed' }]);
      await disconnectStarted.promise;

      let closed = false;
      closePromise = app.close().then(() => {
        closed = true;
      });

      await settleMicrotasks();

      expect(closed).toBe(false);

      disconnectRelease.resolve();
      await closePromise;
    } finally {
      disconnectRelease.resolve();
      await closePromise;
      await app.close();
    }
  });

  it('bounds Worker disconnect cleanup waits by shutdown.timeoutMs', async () => {
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred<void>();
    const disconnectGate = createDeferred<void>();

    class GatewayState {
      disconnectCount = 0;
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/shutdown-disconnect-timeout' })
    class ShutdownGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        connected.resolve();
      }

      @OnDisconnect()
      async onDisconnect() {
        await disconnectGate.promise;
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 1 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/shutdown-disconnect-timeout', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    await connected.promise;

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    await closePromise;

    expect(closed).toBe(true);
    expect(state.disconnectCount).toBe(0);
  });

  it('waits for in-flight Worker connect handlers to replay buffered disconnects during shutdown', async () => {
    const adapter = new TestWorkerAdapter();
    const connectGate = createDeferred<void>();

    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/shutdown-connect-in-flight' })
    class ShutdownGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      async onConnect() {
        await connectGate.promise;
        this.state.connectCount += 1;
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/shutdown-connect-in-flight', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await settleMicrotasks();

    expect(closed).toBe(false);
    expect(state.connectCount).toBe(0);
    expect(state.disconnectCount).toBe(0);

    connectGate.resolve();
    await closePromise;

    expect(state.connectCount).toBe(1);
    expect(state.disconnectCount).toBe(1);
  });

  it('closes Worker sockets when string payloads exceed the configured limit', async () => {
    const adapter = new TestWorkerAdapter();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/payload' })
    class PayloadGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 4,
        },
      })],
      providers: [GatewayState, PayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      const state = await app.container.resolve<GatewayState>(GatewayState);
      await app.listen();

      const server = adapter.getServer();
      await server?.fetch(new Request('https://worker.test/payload', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.emitMessage('hello');
      await settleMicrotasks();

      expect(socket.closeCalls).toEqual([{ code: 1009, reason: 'Payload too large' }]);
      expect(socket.readyState).toBe(WEBSOCKET_CLOSED_READY_STATE);
      expect(state.messages).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('closes Worker sockets when binary payloads exceed the configured limit', async () => {
    const adapter = new TestWorkerAdapter();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/binary-payload' })
    class BinaryPayloadGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 4,
        },
      })],
      providers: [GatewayState, BinaryPayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      const state = await app.container.resolve<GatewayState>(GatewayState);
      await app.listen();

      const server = adapter.getServer();
      await server?.fetch(new Request('https://worker.test/binary-payload', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.emitMessage(new Uint8Array([1, 2, 3, 4, 5]));
      await settleMicrotasks();

      expect(socket.closeCalls).toEqual([{ code: 1009, reason: 'Payload too large' }]);
      expect(socket.readyState).toBe(WEBSOCKET_CLOSED_READY_STATE);
      expect(state.messages).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('receives binary payloads under the configured limit', async () => {
    const adapter = new TestWorkerAdapter();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/binary-ok' })
    class BinaryPayloadGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage()
      onMessage(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 10,
        },
      })],
      providers: [GatewayState, BinaryPayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      const state = await app.container.resolve<GatewayState>(GatewayState);
      await app.listen();

      const server = adapter.getServer();
      await server?.fetch(new Request('https://worker.test/binary-ok', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.emitMessage(new Uint8Array([1, 2, 3, 4]));
      await settleMicrotasks();

      expect(socket.readyState).toBe(WEBSOCKET_OPEN_READY_STATE);
      expect(state.messages).toEqual(['\x01\x02\x03\x04']);
    } finally {
      await app.close();
    }
  });

  it('receives ArrayBuffer and Blob binary event envelopes under the configured limit', async () => {
    const adapter = new TestWorkerAdapter();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/binary-event-ok' })
    class BinaryEventGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 128,
        },
      })],
      providers: [GatewayState, BinaryEventGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      const state = await app.container.resolve<GatewayState>(GatewayState);
      await app.listen();

      const server = adapter.getServer();
      await server?.fetch(new Request('https://worker.test/binary-event-ok', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.emitMessage(new TextEncoder().encode(JSON.stringify({ event: 'ping', data: { value: 'arraybuffer' } })).buffer);
      socket.emitMessage(new Blob([JSON.stringify({ event: 'ping', data: { value: 'blob' } })]));
      await settleMicrotasks();

      expect(socket.readyState).toBe(WEBSOCKET_OPEN_READY_STATE);
      expect(state.messages).toEqual([{ value: 'arraybuffer' }, { value: 'blob' }]);
    } finally {
      await app.close();
    }
  });

  it('closes Worker sockets when Blob payloads exceed the configured limit', async () => {
    const adapter = new TestWorkerAdapter();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/blob-payload' })
    class BlobPayloadGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 4,
        },
      })],
      providers: [GatewayState, BlobPayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      const state = await app.container.resolve<GatewayState>(GatewayState);
      await app.listen();

      const server = adapter.getServer();
      await server?.fetch(new Request('https://worker.test/blob-payload', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;

      if (!socket) {
        throw new Error('Expected Worker test socket to be available after websocket upgrade.');
      }

      socket.emitMessage(new Blob(['hello']));
      await settleMicrotasks();

      expect(socket.closeCalls).toEqual([{ code: 1009, reason: 'Payload too large' }]);
      expect(socket.readyState).toBe(WEBSOCKET_CLOSED_READY_STATE);
      expect(state.messages).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('closes errored Worker sockets and settles disconnect cleanup', async () => {
    // Given
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred();
    const disconnected = createDeferred();
    @WebSocketGateway({ path: '/terminal-error' })
    class TerminalGateway {
      @OnConnect()
      onConnect(): void { connected.resolve(); }
      @OnDisconnect()
      onDisconnect(): void { disconnected.resolve(); }
    }
    class AppModule {}
    defineModule(AppModule, { imports: [CloudflareWorkersWebSocketModule.forRoot()], providers: [TerminalGateway] });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/terminal-error', { headers: { upgrade: 'websocket' } }));
    await connected.promise;
    const socket = server?.lastSocket;
    if (!socket) throw new Error('Expected an open Worker test socket.');

    // When
    socket.emitError();
    await disconnected.promise;

    // Then
    expect(socket.closeCalls).toEqual([{ code: 1011, reason: 'Socket error' }]);
    await app.close();
  });

  it('sends opt-in Worker handler replies with the connection identity', async () => {
    // Given
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred();
    const handled = createDeferred();
    const socketIds: string[] = [];
    @WebSocketGateway({ path: '/replies' })
    class ReplyGateway {
      @OnConnect()
      onConnect(): void { connected.resolve(); }
      @OnMessage('ping')
      onPing(payload: unknown, _socket: CloudflareWorkerWebSocket, _request: Request, socketId: string) {
        socketIds.push(socketId);
        handled.resolve();
        return { data: payload, event: 'pong' };
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ replies: { mode: 'event-envelope' } })],
      providers: [ReplyGateway],
    });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/replies', { headers: { upgrade: 'websocket' } }));
    await connected.promise;
    const socket = server?.lastSocket;
    if (!socket) throw new Error('Expected an open Worker test socket.');

    // When
    socket.emitMessage(JSON.stringify({ data: 'value', event: 'ping' }));
    await handled.promise;
    await app.close();

    // Then
    expect(socketIds).toHaveLength(1);
    expect(socketIds[0]).not.toBe('');
    expect(socket.sentMessages).toContain(JSON.stringify({ data: 'value', event: 'pong' }));
  });

  it.each([
    ['drop-newest', ['first', 'second'], []],
    ['drop-oldest', ['first', 'third'], []],
    ['close', ['first'], [{ code: 1013, reason: 'Ready-state message queue limit exceeded' }]],
  ] as const)('applies Worker %s pending-message overflow policy', async (overflowPolicy, expected, closeCalls) => {
    // Given
    const adapter = new TestWorkerAdapter();
    const connected = createDeferred();
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const messages: string[] = [];
    @WebSocketGateway({ path: '/buffer' })
    class BufferGateway {
      @OnConnect()
      onConnect(): void { connected.resolve(); }
      @OnMessage()
      async onMessage(payload: unknown): Promise<void> {
        messages.push(String(payload));
        if (messages.length === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [CloudflareWorkersWebSocketModule.forRoot({ buffer: { maxPendingMessagesPerSocket: 1, overflowPolicy } })],
      providers: [BufferGateway],
    });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const server = adapter.getServer();
    await server?.fetch(new Request('https://worker.test/buffer', { headers: { upgrade: 'websocket' } }));
    await connected.promise;
    const socket = server?.lastSocket;
    if (!socket) throw new Error('Expected an open Worker test socket.');

    // When
    socket.emitMessage('first');
    await firstStarted.promise;
    socket.emitMessage('second');
    socket.emitMessage('third');
    releaseFirst.resolve();
    await app.close();

    // Then
    expect(messages).toEqual(expected);
    expect(socket.closeCalls).toEqual(closeCalls.length === 0
      ? [{ code: 1001, reason: 'Server shutting down' }]
      : closeCalls);
  });
});
