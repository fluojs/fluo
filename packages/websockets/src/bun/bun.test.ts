import { describe, expect, it } from 'vitest';

import { Inject } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import type { HttpApplicationAdapter } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as bunPublicApi from './bun.js';
import {
  BunWebSocketGatewayLifecycleService,
  BunWebSocketModule,
  type BunServerLike,
  type BunServerWebSocket,
  type BunWebSocketBinding,
  type BunWebSocketBindingHost,
  type BunWebSocketMessage,
} from './bun.js';

type MockSocket = BunServerWebSocket<unknown> & {
  closeCalls: Array<{ code?: number; reason?: string }>;
  sentMessages: string[];
};

const WEBSOCKET_CLOSED_READY_STATE = 3;
const WEBSOCKET_OPEN_READY_STATE = 1;

class TestBunAdapter implements HttpApplicationAdapter, BunWebSocketBindingHost {
  private binding?: BunWebSocketBinding<unknown>;
  private server?: TestBunServer;

  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void {
    this.binding = binding as BunWebSocketBinding<unknown> | undefined;
  }

  getRealtimeCapability() {
    return {
      contract: 'raw-websocket-expansion' as const,
      kind: 'fetch-style' as const,
      mode: 'request-upgrade' as const,
      reason:
        'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @fluojs/websockets/bun for the official raw websocket binding.',
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

class TestBunServer implements BunServerLike {
  closeDeliveryPromise?: Promise<void>;
  lastSocket?: MockSocket;

  constructor(private readonly binding?: BunWebSocketBinding<unknown>) {}

  hostname = '127.0.0.1';
  port = 3000;
  url = new URL('http://127.0.0.1:3000');

  async fetch(request: Request): Promise<Response | undefined> {
    if (!this.binding) {
      return new Response(null, { status: 404 });
    }

    return await this.binding.fetch(request, this);
  }

  stop(): void {}

  async emitClose(code: number, reason: string): Promise<void> {
    if (this.binding && this.lastSocket) {
      await Promise.resolve(this.binding.websocket.close?.(this.lastSocket, code, reason));
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
    void Promise.resolve(this.binding.websocket.open?.(socket));
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

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

    await app.listen();

    const server = adapter.getServer();
    const upgradeResponse = await server?.fetch(new Request('http://127.0.0.1:3000/chat', {
      headers: { upgrade: 'websocket' },
    }));

    await flushAsyncWork();

    const socket = server?.lastSocket;
    expect(upgradeResponse).toBeUndefined();
    expect(socket).toBeDefined();

    if (!server || !socket) {
      throw new Error('Expected Bun test server and socket to be available after websocket upgrade.');
    }

    await server.emitMessage(JSON.stringify({ event: 'ping', data: { value: 'hello' } }));
    await flushAsyncWork();

    await server.emitClose(1000, 'done');
    await flushAsyncWork();

    expect(state.connectCount).toBe(1);
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(socket?.sentMessages).toEqual(['{"event":"pong","data":{"value":"hello"}}']);
    expect(state.disconnectCount).toBe(1);

    await app.close();
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
    await app.listen();

    const response = await adapter.getServer()?.fetch(new Request('http://127.0.0.1:3000/guarded', {
      headers: { upgrade: 'websocket' },
    }));

    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe('Authentication required.');

    await app.close();
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

    await flushAsyncWork();

    const secondUpgrade = await server?.fetch(new Request('http://127.0.0.1:3000/limited-race', {
      headers: { upgrade: 'websocket' },
    }));

    expect(secondUpgrade?.status).toBe(429);

    guardGate.resolve();

    expect(await firstUpgradePromise).toBeUndefined();

    await app.close();
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

    await flushAsyncWork();

    const socket = server?.lastSocket;
    expect(upgradeResponse).toBeUndefined();

    if (!socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    await connected.promise;
    await app.close();
    await flushAsyncWork();

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
    await flushAsyncWork();

    if (!server) {
      throw new Error('Expected Bun test server to be available after websocket upgrade.');
    }

    await connected.promise;
    server.closeDeliveryPromise = closeGate.promise;

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await flushAsyncWork();

    expect(closed).toBe(false);
    expect(state.disconnectCount).toBe(0);

    closeGate.resolve();
    await closePromise;

    expect(state.disconnectCount).toBe(1);
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
    await flushAsyncWork();

    let closed = false;
    const closePromise = app.close().then(() => {
      closed = true;
    });

    await flushAsyncWork();

    expect(closed).toBe(false);
    expect(state.connectCount).toBe(0);
    expect(state.disconnectCount).toBe(0);

    connectGate.resolve();
    await closePromise;

    expect(state.connectCount).toBe(1);
    expect(state.disconnectCount).toBe(1);
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
    await flushAsyncWork();

    const socket = server?.lastSocket;

    if (!server || !socket) {
      throw new Error('Expected Bun test socket to be available after websocket upgrade.');
    }

    await server.emitMessage('hello');
    await flushAsyncWork();

    expect(socket.closeCalls).toEqual([{ code: 1009, reason: 'Payload too large' }]);
    expect(state.messages).toEqual([]);

    await app.close();
  });
});
