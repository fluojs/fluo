import { Inject } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { type HttpApplicationAdapter, UnauthorizedException } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { createFetchStyleWebSocketConformanceHarness } from '@fluojs/testing/fetch-style-websocket-conformance';
import { describe, expect, it } from 'vitest';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as bunPublicApi from './bun.js';
import {
  type BunServerWebSocket,
  type BunWebSocketBinding,
  type BunWebSocketBindingHost,
  BunWebSocketGatewayLifecycleService,
  type BunWebSocketMessage,
  BunWebSocketModule,
  type BunWebSocketUpgradeHost,
} from './bun.js';

type MockSocket = BunServerWebSocket<unknown> & {
  closeCalls: Array<{ code?: number; reason?: string }>;
  sentMessages: string[];
};

const WEBSOCKET_CLOSED_READY_STATE = 3;
const WEBSOCKET_OPEN_READY_STATE = 1;
const BUN_WEBSOCKET_CAPABILITY_REASON =
  'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @fluojs/websockets/bun for the official raw websocket binding.';

class TestBunAdapter implements HttpApplicationAdapter, BunWebSocketBindingHost {
  private binding?: BunWebSocketBinding<unknown>;
  readonly bindingConfigurations: Array<BunWebSocketBinding<unknown> | undefined> = [];
  private server?: TestBunServer;

  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void {
    this.binding = binding as BunWebSocketBinding<unknown> | undefined;
    this.bindingConfigurations.push(this.binding);
  }

  getRealtimeCapability() {
    return {
      contract: 'raw-websocket-expansion' as const,
      kind: 'fetch-style' as const,
      mode: 'request-upgrade' as const,
      reason: BUN_WEBSOCKET_CAPABILITY_REASON,
      support: 'supported' as const,
      version: 1 as const,
    };
  }

  getServer(): TestBunServer | undefined {
    return this.server;
  }

  async listen(): Promise<void> {
    this.server = new TestBunServer(this.binding);
  }

  async close(): Promise<void> {
    this.server = undefined;
  }
}

class TestBunServer {
  closeDeliveryPromise?: Promise<void>;
  lastSocket?: MockSocket;
  openDeliveryPromise?: Promise<void>;

  constructor(private readonly binding?: BunWebSocketBinding<unknown>) {}

  hostname = '127.0.0.1';
  port = 3000;
  url = new URL('http://127.0.0.1:3000');

  async fetch(request: Request): Promise<Response | undefined> {
    if (!this.binding) {
      return new Response(null, { status: 404 });
    }

    const upgradeHost: BunWebSocketUpgradeHost = {
      upgrade: (upgradeRequest, options) => this.upgrade(upgradeRequest, options),
    };

    return await this.binding.fetch(request, upgradeHost);
  }

  stop(): void {}

  async emitClose(code: number, reason: string): Promise<void> {
    if (this.binding && this.lastSocket) {
      await Promise.resolve(this.binding.websocket.close?.(this.lastSocket, code, reason));
    }
  }

  async emitError(error: Error): Promise<void> {
    if (this.binding && this.lastSocket) {
      await Promise.resolve(this.binding.websocket.error?.(this.lastSocket, error));
    }
  }

  async emitMessage(message: BunWebSocketMessage): Promise<void> {
    if (this.binding && this.lastSocket) {
      await Promise.resolve(this.binding.websocket.message?.(this.lastSocket, message));
    }
  }

  upgrade<TData>(_request: Request, options?: { data?: TData; headers?: HeadersInit }): boolean {
    if (!this.binding) {
      return false;
    }

    let socket!: MockSocket;
    socket = createMockSocket(options?.data, (code, reason) => {
      const deliver = () => Promise.resolve(this.binding?.websocket.close?.(socket, code ?? 1000, reason ?? ''));
      if (this.closeDeliveryPromise) {
        return this.closeDeliveryPromise.then(deliver);
      }

      return deliver();
    });
    this.lastSocket = socket;

    const deliverOpen = () => Promise.resolve(this.binding?.websocket.open?.(socket));

    if (this.openDeliveryPromise) {
      void this.openDeliveryPromise.then(deliverOpen);
    } else {
      void deliverOpen();
    }

    return true;
  }
}

function createMockSocket(
  data: unknown,
  onClose?: (code?: number, reason?: string) => void,
): MockSocket {
  const subscriptions = new Set<string>();
  let readyState = WEBSOCKET_OPEN_READY_STATE;
  const socket: MockSocket = {
    close(code?: number, reason?: string) {
      if (readyState === WEBSOCKET_CLOSED_READY_STATE) {
        return;
      }

      readyState = WEBSOCKET_CLOSED_READY_STATE;
      socket.closeCalls.push({ code, reason });
      onClose?.(code, reason);
    },
    closeCalls: [],
    cork(callback: (target: BunServerWebSocket<unknown>) => void) {
      callback(socket);
    },
    data,
    isSubscribed(topic: string) {
      return subscriptions.has(topic);
    },
    publish() {},
    get readyState() {
      return readyState;
    },
    remoteAddress: '127.0.0.1',
    send(message: BunWebSocketMessage) {
      if (typeof message === 'string') {
        socket.sentMessages.push(message);
      } else if (message instanceof ArrayBuffer) {
        socket.sentMessages.push(Buffer.from(message).toString('utf8'));
      } else {
        socket.sentMessages.push(Buffer.from(message.buffer, message.byteOffset, message.byteLength).toString('utf8'));
      }

      return 1;
    },
    sentMessages: [],
    subscribe(topic: string) {
      subscriptions.add(topic);
    },
    get subscriptions() {
      return [...subscriptions];
    },
    unsubscribe(topic: string) {
      subscriptions.delete(topic);
    },
  };

  return socket;
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

describe('@fluojs/websockets/bun', () => {
  it('exposes the explicit Bun websocket seam', () => {
    expect(bunPublicApi).toHaveProperty('BunWebSocketModule');
    expect(bunPublicApi).toHaveProperty('BunWebSocketGatewayLifecycleService');
    expect(bunPublicApi).not.toHaveProperty('createBunWebSocketProviders');
  });

  it('wires the Bun lifecycle service through Bun-only providers', () => {
    const options = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = getModuleMetadata(BunWebSocketModule.forRoot(options))?.providers ?? [];
    const optionsProvider = providers.find(
      (provider: unknown) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(BunWebSocketGatewayLifecycleService);
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('reports the supported fetch-style websocket contract through the conformance harness', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => new TestBunAdapter(),
      expectedReason: BUN_WEBSOCKET_CAPABILITY_REASON,
      expectedSupport: 'supported',
      name: 'websockets bun test adapter',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('rejects serverBacked gateway opt-in on the Bun fetch-style binding', async () => {
    const adapter = new TestBunAdapter();

    @WebSocketGateway({ path: '/chat', serverBacked: { port: 4101 } })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    await expect(
      bootstrapApplication({
        adapter,
        rootModule: AppModule,
      }),
    ).rejects.toThrow('@WebSocketGateway({ serverBacked }) is not supported on @fluojs/websockets/bun');
  });

  it('preserves Bun-backed websocket behavior through the explicit bun seam', async () => {
    const adapter = new TestBunAdapter();

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
      onPing(payload: unknown, socket: BunServerWebSocket) {
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
      imports: [BunWebSocketModule.forRoot()],
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
      const upgradeResponse = await server?.fetch(new Request('http://127.0.0.1:3000/chat', {
        headers: { upgrade: 'websocket' },
      }));

      await settleMicrotasks();

      const socket = server?.lastSocket;
      expect(upgradeResponse).toBeUndefined();
      expect(socket).toBeDefined();

      if (!server || !socket) {
        throw new Error('Expected Bun test server and socket to be available after websocket upgrade.');
      }

      await server.emitMessage(JSON.stringify({ event: 'ping', data: { value: 'hello' } }));
      await settleMicrotasks();

      await server.emitClose(1000, 'done');
      await settleMicrotasks();

      expect(state.connectCount).toBe(1);
      expect(state.messages).toEqual([{ value: 'hello' }]);
      expect(socket?.sentMessages).toEqual(['{"event":"pong","data":{"value":"hello"}}']);
      expect(state.disconnectCount).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('manages rooms and rejects stale joins through the Bun lifecycle service', async () => {
    const adapter = new TestBunAdapter();

    @WebSocketGateway({ path: '/rooms' })
    class RoomGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot()],
      providers: [RoomGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const service = await app.container.resolve<BunWebSocketGatewayLifecycleService>(BunWebSocketGatewayLifecycleService);
    service.joinRoom('socket-unknown', 'room-stale');
    expect(Array.from(service.getRooms('socket-unknown'))).toEqual([]);

    try {
      await app.listen();
      const server = adapter.getServer();
      const upgradeResponse = await server?.fetch(new Request('http://127.0.0.1:3000/rooms', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;
      const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, BunServerWebSocket>;
      const socketId = socketRegistry.keys().next().value;
      expect(upgradeResponse).toBeUndefined();

      if (!socket || typeof socketId !== 'string') {
        throw new Error('Expected Bun room test socket registration after websocket upgrade.');
      }

      service.joinRoom(socketId, 'room-a');
      service.joinRoom(socketId, 'room-b');

      expect(Array.from(service.getRooms(socketId)).sort()).toEqual(['room-a', 'room-b']);

      service.broadcastToRoom('room-a', 'order.updated', { orderId: 'ord_bun' });
      service.leaveRoom(socketId, 'room-a');
      service.broadcastToRoom('room-a', 'order.updated', { orderId: 'ord_after_leave' });

      expect(socket.sentMessages).toEqual([
        JSON.stringify({ data: { orderId: 'ord_bun' }, event: 'order.updated' }),
      ]);
      expect(Array.from(service.getRooms(socketId))).toEqual(['room-b']);

      const closeDelivery = createDeferred<void>();
      server.closeDeliveryPromise = closeDelivery.promise;
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

  it('awaits raw Bun handler return promises before ignoring returned values', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot()],
      providers: [GatewayState, ReturnOnlyGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);

    try {
      await app.listen();

      const server = adapter.getServer();
      const upgradeResponse = await server?.fetch(new Request('http://127.0.0.1:3000/ignored-return', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      const socket = server?.lastSocket;
      expect(upgradeResponse).toBeUndefined();
      expect(socket).toBeDefined();

      if (!server || !socket) {
        throw new Error('Expected Bun test server and socket to be available after websocket upgrade.');
      }

      await server.emitMessage(JSON.stringify({ event: 'first', data: { value: 'ignored' } }));
      await server.emitMessage(JSON.stringify({ event: 'second', data: { value: 'after' } }));
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

  it.each([
    ['true', (): true => true, undefined],
    ['undefined', (): undefined => undefined, undefined],
    ['no return value', (): void => {}, undefined],
    ['false', (): false => false, 403],
  ] as const)('maps a Bun guard %s outcome to the documented upgrade decision', async (_outcome, guard, expectedStatus) => {
    const adapter = new TestBunAdapter();

    @WebSocketGateway({ path: '/guard-outcome' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({ upgrade: { guard } })],
      providers: [GuardedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    try {
      await app.listen();

      const server = adapter.getServer();
      const response = await server?.fetch(new Request('http://127.0.0.1:3000/guard-outcome', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();

      expect(response?.status).toBe(expectedStatus);
      expect(server?.lastSocket !== undefined).toBe(expectedStatus === undefined);
    } finally {
      await app.close();
    }
  });

  it('rejects anonymous upgrade requests before the Bun websocket upgrade completes', async () => {
    const adapter = new TestBunAdapter();

    @WebSocketGateway({ path: '/guarded' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
        upgrade: {
          guard(request) {
            return request instanceof Request && request.headers.get('authorization') === 'Bearer bun'
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

      const response = await adapter.getServer()?.fetch(new Request('http://127.0.0.1:3000/guarded', {
        headers: { upgrade: 'websocket' },
      }));

      expect(response?.status).toBe(401);
      expect(await response?.text()).toBe('Authentication required.');
    } finally {
      await app.close();
    }
  });

  it('maps thrown Bun guard exceptions to rejected websocket upgrades', async () => {
    const adapter = new TestBunAdapter();

    @WebSocketGateway({ path: '/thrown-guard' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
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

      const response = await adapter.getServer()?.fetch(new Request('http://127.0.0.1:3000/thrown-guard', {
        headers: { upgrade: 'websocket' },
      }));

      expect(response?.status).toBe(401);
      expect(await response?.text()).toBe('Authentication required.');
    } finally {
      await app.close();
    }
  });

  it('rejects Bun upgrades that exceed the configured connection limit', async () => {
    const adapter = new TestBunAdapter();

    @WebSocketGateway({ path: '/limited' })
    class LimitedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
        limits: {
          maxConnections: 1,
        },
      })],
      providers: [LimitedGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();

    const server = adapter.getServer();
    const firstUpgrade = await server?.fetch(new Request('http://127.0.0.1:3000/limited', {
      headers: { upgrade: 'websocket' },
    }));
    const secondUpgrade = await server?.fetch(new Request('http://127.0.0.1:3000/limited', {
      headers: { upgrade: 'websocket' },
    }));

    expect(firstUpgrade).toBeUndefined();
    expect(secondUpgrade?.status).toBe(429);

    await app.close();
  });

  it('rejects concurrent Bun upgrades once one pending upgrade already reserved the last slot', async () => {
    const adapter = new TestBunAdapter();
    const guardGate = createDeferred<void>();

    @WebSocketGateway({ path: '/limited-race' })
    class LimitedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
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
    const firstUpgradePromise = server?.fetch(new Request('http://127.0.0.1:3000/limited-race', {
      headers: { upgrade: 'websocket' },
    }));

    await settleMicrotasks();

    const secondUpgrade = await server?.fetch(new Request('http://127.0.0.1:3000/limited-race', {
      headers: { upgrade: 'websocket' },
    }));

    expect(secondUpgrade?.status).toBe(429);

    guardGate.resolve();

    expect(await firstUpgradePromise).toBeUndefined();

    await app.close();
  });

  it('rejects in-flight Bun upgrades once shutdown begins during an async guard', async () => {
    const adapter = new TestBunAdapter();
    const guardGate = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown-guard-race' })
    class GuardedGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
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
    const upgradePromise = server?.fetch(new Request('http://127.0.0.1:3000/shutdown-guard-race', {
      headers: { upgrade: 'websocket' },
    }));

    await settleMicrotasks();

    const closePromise = app.close();

    guardGate.resolve();

    const response = await upgradePromise;

    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe('WebSocket server is shutting down.');
    expect(server?.lastSocket).toBeUndefined();

    await closePromise;
  });

  it('closes Bun sockets and runs disconnect cleanup during application shutdown', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({
        shutdown: { timeoutMs: 200 },
      })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    const service = await app.container.resolve(BunWebSocketGatewayLifecycleService);
    await app.listen();

    const server = adapter.getServer();
    const upgradeResponse = await server?.fetch(new Request('http://127.0.0.1:3000/shutdown', {
      headers: { upgrade: 'websocket' },
    }));

    await settleMicrotasks();

    const socket = server?.lastSocket;
    expect(upgradeResponse).toBeUndefined();

    if (!socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    await connected.promise;
    await app.close();
    await settleMicrotasks();

    expect(socket.closeCalls).toEqual([{ code: 1001, reason: 'Server shutting down' }]);
    expect(socket.readyState).toBe(WEBSOCKET_CLOSED_READY_STATE);
    expect(state.connectCount).toBe(1);
    expect(state.disconnectCount).toBe(1);
    expect((Reflect.get(service, 'socketRegistry') as Map<string, MockSocket>).size).toBe(0);
  });

  it('waits for asynchronously delivered Bun close events during shutdown', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/shutdown-async-close', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    if (!server) {
      throw new Error('Expected Bun test server to be available after websocket upgrade.');
    }

    await connected.promise;
    server.closeDeliveryPromise = closeGate.promise;

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

  it('waits for asynchronous Bun disconnect cleanup before finishing shutdown', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/shutdown-async-disconnect', {
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

  it('waits for Bun disconnect cleanup already queued when shutdown starts', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      await app.listen();
      const server = adapter.getServer();

      await server?.fetch(new Request('http://127.0.0.1:3000/shutdown-queued-disconnect', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();
      await connected.promise;
      await server?.emitClose(1000, 'Client closed');
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

  it('waits for Bun disconnect cleanup queued after a room broadcast send failure', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const service = await app.container.resolve<BunWebSocketGatewayLifecycleService>(BunWebSocketGatewayLifecycleService);
    let closePromise: Promise<void> | undefined;

    try {
      await app.listen();
      const server = adapter.getServer();

      await server?.fetch(new Request('http://127.0.0.1:3000/shutdown-broadcast-failure', {
        headers: { upgrade: 'websocket' },
      }));
      await settleMicrotasks();
      await connected.promise;

      const socket = server?.lastSocket;
      const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, BunServerWebSocket>;
      const socketId = socketRegistry.keys().next().value;

      if (!socket || typeof socketId !== 'string') {
        throw new Error('Expected Bun broadcast failure test socket registration after websocket upgrade.');
      }

      service.joinRoom(socketId, 'shutdown-room');
      socket.send = () => 0;
      service.broadcastToRoom('shutdown-room', 'shutdown.test', undefined);
      socket.close(1000, 'Client closed');
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

  it('bounds Bun disconnect cleanup waits by shutdown.timeoutMs', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 1 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/shutdown-disconnect-timeout', {
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

  it('waits for in-flight Bun connect handlers to replay buffered disconnects during shutdown', async () => {
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/shutdown-connect-in-flight', {
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

  it('keeps shutdown pending across the Bun upgrade-success before open-callback race', async () => {
    const adapter = new TestBunAdapter();
    const openGate = createDeferred<void>();

    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/shutdown-open-race' })
    class ShutdownGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        this.state.connectCount += 1;
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnectCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [GatewayState, ShutdownGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    const service = await app.container.resolve(BunWebSocketGatewayLifecycleService);
    await app.listen();

    const server = adapter.getServer();

    if (!server) {
      throw new Error('Expected Bun test server to be available after application listen.');
    }

    server.openDeliveryPromise = openGate.promise;

    const upgradeResponse = await server.fetch(new Request('http://127.0.0.1:3000/shutdown-open-race', {
      headers: { upgrade: 'websocket' },
    }));

    const socket = server.lastSocket;

    expect(upgradeResponse).toBeUndefined();

    if (!socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await settleMicrotasks();

    expect(closed).toBe(false);
    expect(socket.closeCalls).toEqual([]);
    expect((Reflect.get(service, 'socketRegistry') as Map<string, MockSocket>).size).toBe(0);

    openGate.resolve();
    await closePromise;
    await settleMicrotasks();

    expect(closed).toBe(true);
    expect(socket.closeCalls).toEqual([{ code: 1001, reason: 'Server shutting down' }]);
    expect(socket.readyState).toBe(WEBSOCKET_CLOSED_READY_STATE);
    expect(state.connectCount).toBe(1);
    expect(state.disconnectCount).toBe(1);
    expect((Reflect.get(service, 'socketRegistry') as Map<string, MockSocket>).size).toBe(0);
  });

  it('closes Bun sockets when inbound payloads exceed the configured limit', async () => {
    const adapter = new TestBunAdapter();

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
      imports: [BunWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 4,
        },
      })],
      providers: [GatewayState, PayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/payload', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    const socket = server?.lastSocket;

    if (!server || !socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    await server.emitMessage('hello');
    await settleMicrotasks();

    expect(socket.closeCalls).toEqual([{ code: 1009, reason: 'Payload too large' }]);
    expect(state.messages).toEqual([]);

    await app.close();
  });

  it('closes Bun sockets when binary payloads exceed the configured limit', async () => {
    const adapter = new TestBunAdapter();

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
      imports: [BunWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 4,
        },
      })],
      providers: [GatewayState, BinaryPayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/binary-payload', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    const socket = server?.lastSocket;

    if (!server || !socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    await server.emitMessage(new Uint8Array([1, 2, 3, 4, 5]));
    await settleMicrotasks();

    expect(socket.closeCalls).toEqual([{ code: 1009, reason: 'Payload too large' }]);
    expect(state.messages).toEqual([]);

    await app.close();
  });

  it('receives binary payloads under the configured limit', async () => {
    const adapter = new TestBunAdapter();

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
      imports: [BunWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 10,
        },
      })],
      providers: [GatewayState, BinaryPayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/binary-ok', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    const socket = server?.lastSocket;

    if (!server || !socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    await server.emitMessage(new Uint8Array([1, 2, 3, 4]));
    await settleMicrotasks();

    expect(socket.closeCalls).toEqual([]);
    expect(state.messages).toEqual(['\x01\x02\x03\x04']);

    await app.close();
  });

  it('receives Bun ArrayBuffer payloads under the configured limit', async () => {
    const adapter = new TestBunAdapter();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/array-buffer-ok' })
    class ArrayBufferPayloadGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
        limits: {
          maxPayloadBytes: 64,
        },
      })],
      providers: [GatewayState, ArrayBufferPayloadGateway],
    });

    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    const state = await app.container.resolve<GatewayState>(GatewayState);
    await app.listen();

    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/array-buffer-ok', {
      headers: { upgrade: 'websocket' },
    }));
    await settleMicrotasks();

    const socket = server?.lastSocket;

    if (!server || !socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    const encodedPayload = new TextEncoder().encode(JSON.stringify({ event: 'ping', data: { value: 'array-buffer' } }));
    const arrayBufferPayload = encodedPayload.buffer.slice(
      encodedPayload.byteOffset,
      encodedPayload.byteOffset + encodedPayload.byteLength,
    ) as ArrayBuffer;

    await server.emitMessage(arrayBufferPayload);
    await settleMicrotasks();

    expect(socket.closeCalls).toEqual([]);
    expect(state.messages).toEqual([{ value: 'array-buffer' }]);

    await app.close();
  });

  it('preserves the host-owned Bun binding during shutdown', async () => {
    // Given
    const adapter = new TestBunAdapter();
    @WebSocketGateway({ path: '/binding' })
    class BindingGateway {}
    class AppModule {}
    defineModule(AppModule, { imports: [BunWebSocketModule.forRoot()], providers: [BindingGateway] });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();

    // When
    await app.close();

    // Then
    expect(adapter.bindingConfigurations).toHaveLength(1);
    expect(adapter.bindingConfigurations[0]).toBeDefined();
  });

  it('closes errored Bun sockets and settles disconnect cleanup', async () => {
    // Given
    const adapter = new TestBunAdapter();
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
    defineModule(AppModule, { imports: [BunWebSocketModule.forRoot()], providers: [TerminalGateway] });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/terminal-error', { headers: { upgrade: 'websocket' } }));
    await connected.promise;
    const socket = server?.lastSocket;
    if (!server || !socket) throw new Error('Expected an open Bun test socket.');

    // When
    await server.emitError(new Error('terminal'));
    await disconnected.promise;

    // Then
    expect(socket.closeCalls).toEqual([{ code: 1011, reason: 'Socket error' }]);
    await app.close();
  });

  it('sends opt-in Bun handler replies with the connection identity', async () => {
    // Given
    const adapter = new TestBunAdapter();
    const connected = createDeferred();
    const handled = createDeferred();
    const socketIds: string[] = [];
    @WebSocketGateway({ path: '/replies' })
    class ReplyGateway {
      @OnConnect()
      onConnect(): void { connected.resolve(); }
      @OnMessage('ping')
      onPing(payload: unknown, _socket: BunServerWebSocket, _request: Request, socketId: string) {
        socketIds.push(socketId);
        handled.resolve();
        return { data: payload, event: 'pong' };
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({ replies: { mode: 'event-envelope' } })],
      providers: [ReplyGateway],
    });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/replies', { headers: { upgrade: 'websocket' } }));
    await connected.promise;
    const socket = server?.lastSocket;
    if (!server || !socket) throw new Error('Expected an open Bun test socket.');

    // When
    await server.emitMessage(JSON.stringify({ data: 'value', event: 'ping' }));
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
  ] as const)('applies Bun %s pending-message overflow policy', async (overflowPolicy, expected, closeCalls) => {
    // Given
    const adapter = new TestBunAdapter();
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
      imports: [BunWebSocketModule.forRoot({ buffer: { maxPendingMessagesPerSocket: 1, overflowPolicy } })],
      providers: [BufferGateway],
    });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const server = adapter.getServer();
    await server?.fetch(new Request('http://127.0.0.1:3000/buffer', { headers: { upgrade: 'websocket' } }));
    await connected.promise;
    const socket = server?.lastSocket;
    if (!server || !socket) throw new Error('Expected an open Bun test socket.');

    // When
    await server.emitMessage('first');
    await firstStarted.promise;
    await server.emitMessage('second');
    await server.emitMessage('third');
    releaseFirst.resolve();
    await app.close();

    // Then
    expect(messages).toEqual(expected);
    expect(socket.closeCalls).toEqual(closeCalls.length === 0
      ? [{ code: 1001, reason: 'Server shutting down' }]
      : closeCalls);
  });
});
