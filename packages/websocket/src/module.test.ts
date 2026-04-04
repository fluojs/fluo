import { createConnection, createServer } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { Inject, Scope, getModuleMetadata } from '@konekti/core';
import { Container } from '@konekti/di';
import { bootstrapFastifyApplication } from '@konekti/platform-fastify';
import { bootstrapApplication, bootstrapNodeApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';
import { HTTP_APPLICATION_ADAPTER } from '@konekti/runtime/internal';
import type { HttpApplicationAdapter } from '@konekti/http';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from './decorators.js';
import * as publicApi from './index.js';
import { getWebSocketGatewayMetadata, getWebSocketHandlerMetadataEntries } from './metadata.js';
import { WebSocketModule, createWebSocketProviders } from './module.js';
import { WebSocketGatewayLifecycleService } from './service.js';
import type { WebSocketModuleOptions } from './types.js';

function createLogger(events: string[]): ApplicationLogger {
  return {
    debug(message: string, context?: string) {
      events.push(`debug:${context ?? 'none'}:${message}`);
    },
    error(message: string, error?: unknown, context?: string) {
      events.push(`error:${context ?? 'none'}:${message}:${error instanceof Error ? error.message : 'none'}`);
    },
    log(message: string, context?: string) {
      events.push(`log:${context ?? 'none'}:${message}`);
    },
    warn(message: string, context?: string) {
      events.push(`warn:${context ?? 'none'}:${message}`);
    },
  };
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve available port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function onceMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: unknown) => {
      if (typeof data === 'string') {
        resolve(data);
        return;
      }

      if (data instanceof ArrayBuffer) {
        resolve(Buffer.from(data).toString('utf8'));
        return;
      }

      if (ArrayBuffer.isView(data)) {
        resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'));
        return;
      }

      resolve(String(data));
    });
    socket.once('error', reject);
  });
}

function onceClosed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
  });
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

function createTestLifecycleService(
  options: WebSocketModuleOptions = {},
  loggerEvents: string[] = [],
): WebSocketGatewayLifecycleService {
  const adapter: HttpApplicationAdapter = {
    async close() {},
    getServer() {
      return {
        off() {
          return this;
        },
        on() {
          return this;
        },
      };
    },
    async listen() {},
  };

  return new WebSocketGatewayLifecycleService(new Container(), [], createLogger(loggerEvents), adapter, options);
}

type MockSocketListeners = {
  close?: (code: number, reason: Buffer) => void;
  error?: (error: Error) => void;
  message?: (data: unknown) => void;
  pong?: () => void;
};

function createMockSocket(): {
  emitClose: (code?: number, reason?: Buffer) => void;
  emitError: (error: Error) => void;
  emitPong: () => void;
  ping: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  socket: WebSocket;
  terminate: ReturnType<typeof vi.fn>;
} {
  const listeners: MockSocketListeners = {};
  const ping = vi.fn();
  const send = vi.fn();
  const terminate = vi.fn();

  const socketObject = {
    on(event: 'close' | 'error' | 'message' | 'pong', listener: (...args: unknown[]) => void) {
      if (event === 'close') {
        listeners.close = listener as (code: number, reason: Buffer) => void;
      } else if (event === 'error') {
        listeners.error = listener as (error: Error) => void;
      } else if (event === 'message') {
        listeners.message = listener as (data: unknown) => void;
      } else {
        listeners.pong = listener as () => void;
      }

      return this;
    },
    ping,
    readyState: WebSocket.OPEN,
    send,
    bufferedAmount: 0,
    terminate,
  } as unknown as WebSocket;

  return {
    emitClose(code = 1000, reason = Buffer.alloc(0)) {
      listeners.close?.(code, reason);
    },
    emitError(error: Error) {
      listeners.error?.(error);
    },
    emitPong() {
      listeners.pong?.();
    },
    ping,
    send,
    socket: socketObject,
    terminate,
  };
}

describe('@konekti/websocket', () => {
  it('keeps lifecycle DI tokens internal to module wiring', () => {
    expect(publicApi).not.toHaveProperty('WEBSOCKET_GATEWAY_SERVICE');
    expect(publicApi).not.toHaveProperty('WEBSOCKET_SERVICE');
    expect(publicApi).not.toHaveProperty('WEBSOCKET_OPTIONS');
  });

  it('wires lifecycle service with a direct class provider', () => {
    const options: WebSocketModuleOptions = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = createWebSocketProviders(options);
    const optionsProvider = providers.find(
      (provider) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(WebSocketGatewayLifecycleService);
    expect(optionsProvider).toBeDefined();
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('creates isolated module metadata for separate forRoot invocations', () => {
    const firstModule = WebSocketModule.forRoot({ shutdown: { timeoutMs: 1111 } });
    const secondModule = WebSocketModule.forRoot({ shutdown: { timeoutMs: 2222 } });
    const firstProviders = getModuleMetadata(firstModule)?.providers;
    const secondProviders = getModuleMetadata(secondModule)?.providers;
    const firstOptionsProvider = firstProviders?.find(
      (provider) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    ) as { useValue?: WebSocketModuleOptions } | undefined;
    const secondOptionsProvider = secondProviders?.find(
      (provider) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    ) as { useValue?: WebSocketModuleOptions } | undefined;

    expect(firstModule).not.toBe(secondModule);
    expect(firstOptionsProvider?.useValue).toEqual({ shutdown: { timeoutMs: 1111 } });
    expect(secondOptionsProvider?.useValue).toEqual({ shutdown: { timeoutMs: 2222 } });
  });

  it('writes gateway and handler metadata with standard decorators', () => {
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnConnect()
      onConnect() {}

      @OnMessage('ping')
      onPing() {}

      @OnDisconnect()
      onDisconnect() {}
    }

    expect(getWebSocketGatewayMetadata(ChatGateway)).toEqual({ path: '/chat' });
    expect(getWebSocketHandlerMetadataEntries(ChatGateway.prototype)).toEqual([
      { metadata: { event: undefined, type: 'connect' }, propertyKey: 'onConnect' },
      { metadata: { event: 'ping', type: 'message' }, propertyKey: 'onPing' },
      { metadata: { event: undefined, type: 'disconnect' }, propertyKey: 'onDisconnect' },
    ]);
  });

  it('rejects private and static methods for message handlers', () => {
    const decorator = OnMessage('ping');

    expect(() => {
      decorator(() => undefined, {
        metadata: {},
        name: 'secret',
        private: true,
      } as ClassMethodDecoratorContext);
    }).toThrow('@OnMessage() cannot be used on private methods.');

    expect(() => {
      decorator(() => undefined, {
        metadata: {},
        name: 'staticMessage',
        private: false,
        static: true,
      } as ClassMethodDecoratorContext);
    }).toThrow('@OnMessage() cannot be used on static methods.');
  });

  it('warns and skips non-singleton gateways', async () => {
    const loggerEvents: string[] = [];

    @Scope('request')
    @WebSocketGateway({ path: '/request-gateway' })
    class RequestGateway {
      @OnMessage('ping')
      handlePing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [RequestGateway],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });

    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:WebSocketGatewayLifecycleService:RequestGateway in module AppModule declares @WebSocketGateway() but is registered with request scope.',
        ),
      ),
    ).toBe(true);

    await app.close();
  });

  it('deduplicates duplicate gateway class registration across tokens', async () => {
    const ALIAS_TOKEN = Symbol('alias-token');

    class GatewayState {
      connects = 0;
    }

    @Inject([GatewayState])
    @WebSocketGateway({ path: '/dedupe' })
    class DedupeGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      handleConnect() {
        this.state.connects += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [GatewayState, DedupeGateway, { provide: ALIAS_TOKEN, useClass: DedupeGateway }],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/dedupe`);
    await onceOpen(socket);
    socket.close();
    await onceClosed(socket);

    expect(state.connects).toBe(1);

    await app.close();
  });

  it('fails fast when the HTTP adapter does not expose a Node server', async () => {
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    await expect(
      bootstrapApplication({
        adapter: {
          async close() {},
          async listen() {},
        },
        rootModule: AppModule,
      }),
    ).rejects.toThrow('WebSocket gateway bootstrap requires an HTTP adapter with getServer()');
  });

  it('exposes a Node server through the runtime adapter token', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
    });

    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port: await findAvailablePort(),
    });
    const adapter = await app.container.resolve<HttpApplicationAdapter>(HTTP_APPLICATION_ADAPTER);

    expect(typeof adapter.getServer).toBe('function');
    expect(adapter.getServer?.()).toBeDefined();

    await app.close();
  });

  it('boots a real Node app, connects websocket client, handles message, and disconnects', async () => {
    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
      messages: unknown[] = [];
    }

    @Inject([GatewayState])
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        this.state.connectCount += 1;
      }

      @OnMessage('ping')
      onPing(payload: unknown, socket: WebSocket) {
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
      imports: [WebSocketModule.forRoot()],
      providers: [GatewayState, ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
    await onceOpen(socket);
    socket.send(JSON.stringify({ event: 'ping', data: { value: 'hello' } }));

    const incoming = await onceMessage(socket);
    expect(JSON.parse(incoming)).toEqual({ event: 'pong', data: { value: 'hello' } });

    socket.close();
    await onceClosed(socket);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.connectCount).toBe(1);
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(state.disconnectCount).toBe(1);

    await app.close();
  });

  it('boots a Fastify app, connects websocket client, handles message, and disconnects', async () => {
    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
      messages: unknown[] = [];
    }

    @Inject([GatewayState])
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      onConnect() {
        this.state.connectCount += 1;
      }

      @OnMessage('ping')
      onPing(payload: unknown, socket: WebSocket) {
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
      imports: [WebSocketModule.forRoot()],
      providers: [GatewayState, ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
    await onceOpen(socket);
    socket.send(JSON.stringify({ event: 'ping', data: { value: 'hello' } }));

    const incoming = await onceMessage(socket);
    expect(JSON.parse(incoming)).toEqual({ event: 'pong', data: { value: 'hello' } });

    socket.close();
    await onceClosed(socket);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.connectCount).toBe(1);
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(state.disconnectCount).toBe(1);

    await app.close();
  });

  it('buffers messages and disconnects that arrive before async onConnect completes', async () => {
    const connected = createDeferred<void>();

    class GatewayState {
      disconnects = 0;
      messages: unknown[] = [];
    }

    @Inject([GatewayState])
    @WebSocketGateway({ path: '/async-connect' })
    class AsyncGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      async onConnect() {
        await connected.promise;
      }

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnects += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [GatewayState, AsyncGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    // Connect, send a message, then close — all before onConnect resolves.
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/async-connect`);
    await onceOpen(socket);
    socket.send(JSON.stringify({ event: 'ping', data: 'early' }));
    socket.close();
    await onceClosed(socket);

    connected.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.messages).toEqual(['early']);
    expect(state.disconnects).toBe(1);

    await app.close();
  });

  it('caps pre-ready buffered websocket messages with drop-oldest policy', async () => {
    const connected = createDeferred<void>();

    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject([GatewayState])
    @WebSocketGateway({ path: '/buffer-cap' })
    class BufferedGateway {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      async onConnect() {
        await connected.promise;
      }

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        WebSocketModule.forRoot({
          buffer: {
            maxPendingMessagesPerSocket: 2,
            overflowPolicy: 'drop-oldest',
          },
        }),
      ],
      providers: [GatewayState, BufferedGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/buffer-cap`);
    await onceOpen(socket);
    socket.send(JSON.stringify({ event: 'ping', data: 'a' }));
    socket.send(JSON.stringify({ event: 'ping', data: 'b' }));
    socket.send(JSON.stringify({ event: 'ping', data: 'c' }));
    socket.close();
    await onceClosed(socket);

    connected.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.messages).toEqual(['b', 'c']);

    await app.close();
  });

  it('delivers messages and disconnects that arrive after async onConnect completes', async () => {
    const connected = createDeferred<void>();

    class GatewayState {
      disconnects = 0;
      messages: unknown[] = [];
    }

    @Inject([GatewayState])
    @WebSocketGateway({ path: '/async-connect-then-message' })
    class AsyncGateway2 {
      constructor(private readonly state: GatewayState) {}

      @OnConnect()
      async onConnect() {
        await connected.promise;
      }

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnects += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [GatewayState, AsyncGateway2],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/async-connect-then-message`);
    await onceOpen(socket);

    // Resolve onConnect first, then send message and disconnect.
    connected.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));

    socket.send(JSON.stringify({ event: 'ping', data: 'hello' }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    socket.close();
    await onceClosed(socket);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.messages).toEqual(['hello']);
    expect(state.disconnects).toBe(1);

    await app.close();
  });

  it('runs same-socket gateway handlers in deterministic registration order', async () => {
    class SharedState {
      steps: string[] = [];
    }

    @Inject([SharedState])
    @WebSocketGateway({ path: '/ordered' })
    class FirstGateway {
      constructor(private readonly state: SharedState) {}

      @OnConnect()
      async onConnect() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        this.state.steps.push('first');
      }
    }

    @Inject([SharedState])
    @WebSocketGateway({ path: '/ordered' })
    class SecondGateway {
      constructor(private readonly state: SharedState) {}

      @OnConnect()
      onConnect() {
        this.state.steps.push(`second-after-${this.state.steps.join('|') || 'none'}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [SharedState, FirstGateway, SecondGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(SharedState);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ordered`);
    await onceOpen(socket);
    socket.close();
    await onceClosed(socket);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.steps).toEqual(['first', 'second-after-first']);

    await app.close();
  });

  it('clears heartbeat pending markers when pong is received', async () => {
    const service = createTestLifecycleService();
    const { emitPong, socket } = createMockSocket();
    const bindConnectionHandlers = Reflect.get(service, 'bindConnectionHandlers') as (
      descriptors: unknown[],
      socket: WebSocket,
      request: IncomingMessage,
    ) => Promise<void>;

    await bindConnectionHandlers.call(service, [], socket, {} as IncomingMessage);

    const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, WebSocket>;
    const socketId = Array.from(socketRegistry.keys())[0];

    if (!socketId) {
      throw new Error('Expected socket to be registered for heartbeat tracking.');
    }

    const pingPending = Reflect.get(service, 'pingPending') as Set<string>;
    const pingSentAt = Reflect.get(service, 'pingSentAt') as Map<string, number>;
    pingPending.add(socketId);
    pingSentAt.set(socketId, Date.now());

    emitPong();

    expect(pingPending.has(socketId)).toBe(false);
    expect(pingSentAt.has(socketId)).toBe(false);

    const shutdown = Reflect.get(service, 'shutdown') as () => Promise<void>;
    await shutdown.call(service);
  });

  it('caps ready-state message queue and drops newest queued messages when saturated', async () => {
    const service = createTestLifecycleService({
      buffer: {
        maxPendingMessagesPerSocket: 1,
        overflowPolicy: 'drop-newest',
      },
    });
    const { socket } = createMockSocket();
    const enqueueMessageDispatch = Reflect.get(service, 'enqueueMessageDispatch') as (
      state: {
        enqueuedMessageCount: number;
        handlerQueue: Promise<void>;
        processingMessageQueue: boolean;
        queuedMessages: unknown[];
        resolved: Array<{ descriptor: unknown; instance: unknown }>;
        socketId: string;
      },
      socket: WebSocket,
      request: IncomingMessage,
      data: unknown,
    ) => void;
    const gate = createDeferred<void>();
    const handledPayloads: unknown[] = [];

    Reflect.set(service, 'handleMessage', async (_resolved: unknown, _socket: WebSocket, _request: IncomingMessage, data: unknown) => {
      handledPayloads.push(data);
      await gate.promise;
    });

    const state = {
      enqueuedMessageCount: 0,
      handlerQueue: Promise.resolve(),
      processingMessageQueue: false,
      queuedMessages: [] as unknown[],
      resolved: [],
      socketId: 'socket-ready-1',
    };

    enqueueMessageDispatch.call(service, state, socket, {} as IncomingMessage, 'first');
    enqueueMessageDispatch.call(service, state, socket, {} as IncomingMessage, 'second');
    enqueueMessageDispatch.call(service, state, socket, {} as IncomingMessage, 'third');

    gate.resolve();
    await state.handlerQueue;

    expect(handledPayloads).toEqual(['first', 'second']);
    expect(state.enqueuedMessageCount).toBe(0);
  });

  it('caps ready-state message queue and drops the oldest queued message when configured', async () => {
    const service = createTestLifecycleService({
      buffer: {
        maxPendingMessagesPerSocket: 1,
        overflowPolicy: 'drop-oldest',
      },
    });
    const { socket } = createMockSocket();
    const enqueueMessageDispatch = Reflect.get(service, 'enqueueMessageDispatch') as (
      state: {
        enqueuedMessageCount: number;
        handlerQueue: Promise<void>;
        processingMessageQueue: boolean;
        queuedMessages: unknown[];
        resolved: Array<{ descriptor: unknown; instance: unknown }>;
        socketId: string;
      },
      socket: WebSocket,
      request: IncomingMessage,
      data: unknown,
    ) => void;
    const gate = createDeferred<void>();
    const handledPayloads: unknown[] = [];

    Reflect.set(service, 'handleMessage', async (_resolved: unknown, _socket: WebSocket, _request: IncomingMessage, data: unknown) => {
      handledPayloads.push(data);

      if (data === 'first') {
        await gate.promise;
      }
    });

    const state = {
      enqueuedMessageCount: 0,
      handlerQueue: Promise.resolve(),
      processingMessageQueue: false,
      queuedMessages: [] as unknown[],
      resolved: [],
      socketId: 'socket-ready-drop-oldest',
    };

    enqueueMessageDispatch.call(service, state, socket, {} as IncomingMessage, 'first');
    enqueueMessageDispatch.call(service, state, socket, {} as IncomingMessage, 'second');
    enqueueMessageDispatch.call(service, state, socket, {} as IncomingMessage, 'third');

    gate.resolve();
    await state.handlerQueue;

    expect(handledPayloads).toEqual(['first', 'third']);
    expect(state.enqueuedMessageCount).toBe(0);
  });

  it('terminates sockets when pong timeout is missed and clears heartbeat state', async () => {
    vi.useFakeTimers();

    try {
      const service = createTestLifecycleService();
      const { ping, socket, terminate } = createMockSocket();
      const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, WebSocket>;
      socketRegistry.set('socket-1', socket);

      const startHeartbeat = Reflect.get(service, 'startHeartbeat') as (intervalMs: number, timeoutMs: number) => void;
      startHeartbeat.call(service, 100, 150);

      await vi.advanceTimersByTimeAsync(100);
      expect(ping).toHaveBeenCalledTimes(1);

      const pingPending = Reflect.get(service, 'pingPending') as Set<string>;
      const pingSentAt = Reflect.get(service, 'pingSentAt') as Map<string, number>;
      expect(pingPending.has('socket-1')).toBe(true);
      expect(pingSentAt.has('socket-1')).toBe(true);

      await vi.advanceTimersByTimeAsync(200);

      expect(terminate).toHaveBeenCalledTimes(1);
      expect(socketRegistry.has('socket-1')).toBe(false);
      expect(pingPending.has('socket-1')).toBe(false);
      expect(pingSentAt.has('socket-1')).toBe(false);

      const shutdown = Reflect.get(service, 'shutdown') as () => Promise<void>;
      await shutdown.call(service);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops room broadcasts when socket bufferedAmount exceeds backpressure threshold', () => {
    const service = createTestLifecycleService({
      backpressure: {
        maxBufferedAmountBytes: 1,
        policy: 'drop',
      },
    });
    const { send, socket, terminate } = createMockSocket();
    (socket as unknown as { bufferedAmount: number }).bufferedAmount = 4;

    const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, WebSocket>;
    const roomSockets = Reflect.get(service, 'roomSockets') as Map<string, Set<string>>;
    socketRegistry.set('socket-1', socket);
    roomSockets.set('room-1', new Set(['socket-1']));

    service.broadcastToRoom('room-1', 'event', { value: 'payload' });

    expect(send).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('terminates sockets on backpressure when policy is close', () => {
    const service = createTestLifecycleService({
      backpressure: {
        maxBufferedAmountBytes: 1,
        policy: 'close',
      },
    });
    const { send, socket, terminate } = createMockSocket();
    (socket as unknown as { bufferedAmount: number }).bufferedAmount = 4;

    const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, WebSocket>;
    const roomSockets = Reflect.get(service, 'roomSockets') as Map<string, Set<string>>;
    socketRegistry.set('socket-1', socket);
    roomSockets.set('room-1', new Set(['socket-1']));

    service.broadcastToRoom('room-1', 'event', { value: 'payload' });

    expect(send).not.toHaveBeenCalled();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(socketRegistry.has('socket-1')).toBe(false);
  });

  it('returns room snapshots so external mutation cannot corrupt internal room indexes', () => {
    const service = createTestLifecycleService();

    service.joinRoom('socket-1', 'room-a');
    service.joinRoom('socket-1', 'room-b');

    const snapshot = service.getRooms('socket-1') as Set<string>;
    snapshot.delete('room-a');
    snapshot.add('room-c');

    const nextSnapshot = service.getRooms('socket-1');

    expect(Array.from(nextSnapshot).sort()).toEqual(['room-a', 'room-b']);
  });

  it('logs and continues shutdown when websocket server close exceeds timeout', async () => {
    vi.useFakeTimers();

    try {
      const loggerEvents: string[] = [];
      const service = createTestLifecycleService({ shutdown: { timeoutMs: 25 } }, loggerEvents);
      const hangingServer = {
        clients: new Set<WebSocket>(),
        close(_callback?: (error?: Error) => void) {},
      };

      Reflect.set(service, 'attachments', [
        {
          descriptors: [],
          path: '/hang',
          server: hangingServer,
        },
      ]);

      const shutdown = Reflect.get(service, 'shutdown') as () => Promise<void>;
      const shutdownPromise = shutdown.call(service);

      await vi.advanceTimersByTimeAsync(25);
      await shutdownPromise;

      expect(
        loggerEvents.some((event) =>
          event.includes('error:WebSocketGatewayLifecycleService:Failed to close websocket server for path /hang within 25ms.'),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delegates unmatched websocket upgrade requests to later listeners', async () => {
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const adapter = await app.container.resolve<HttpApplicationAdapter>(HTTP_APPLICATION_ADAPTER);
    const server = adapter.getServer?.() as {
      on(event: 'upgrade', listener: (request: IncomingMessage, socket: Duplex) => void): void;
    };
    const delegated = createDeferred<void>();

    server.on('upgrade', (request, socket) => {
      if (request.url === '/missing') {
        delegated.resolve();
        socket.write('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      }
    });

    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.write(
          'GET /missing HTTP/1.1\r\n'
            + 'Host: 127.0.0.1\r\n'
            + 'Connection: Upgrade\r\n'
            + 'Upgrade: websocket\r\n'
            + 'Sec-WebSocket-Version: 13\r\n'
            + 'Sec-WebSocket-Key: dGVzdC1rZXktMDAwMDAw\r\n'
            + '\r\n',
        );
      });
      const chunks: Buffer[] = [];

      socket.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      socket.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      socket.on('error', reject);
    });

    await delegated.promise;
    expect(response).toContain('HTTP/1.1 426 Upgrade Required');

    await app.close();
  });

  it('rejects unmatched websocket upgrade requests with 404 when no later listener handles them', async () => {
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.write(
          'GET /missing HTTP/1.1\r\n'
            + 'Host: 127.0.0.1\r\n'
            + 'Connection: Upgrade\r\n'
            + 'Upgrade: websocket\r\n'
            + 'Sec-WebSocket-Version: 13\r\n'
            + 'Sec-WebSocket-Key: dGVzdC1rZXktMDAwMDAw\r\n'
            + '\r\n',
        );
      });
      const chunks: Buffer[] = [];

      socket.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      socket.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      socket.on('error', reject);
    });

    expect(response).toContain('HTTP/1.1 404 Not Found');

    await app.close();
  });


  it('rejects malformed websocket upgrade URLs without crashing the server', async () => {
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const malformedResponse = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.write(
          'GET http://%zz HTTP/1.1\r\n'
            + 'Host: 127.0.0.1\r\n'
            + 'Connection: Upgrade\r\n'
            + 'Upgrade: websocket\r\n'
            + 'Sec-WebSocket-Version: 13\r\n'
            + 'Sec-WebSocket-Key: dGVzdC1rZXktMDAwMDAw\r\n'
            + '\r\n',
        );
      });
      const chunks: Buffer[] = [];

      socket.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      socket.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      socket.on('error', reject);
    });

    expect(malformedResponse).toContain('HTTP/1.1 400 Bad Request');

    const followup = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
    await onceOpen(followup);
    followup.close();

    await app.close();
  });

  it('closes active websocket clients during application shutdown', async () => {
    const connected = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown' })
    class ShutdownGateway {
      @OnConnect()
      onConnect() {
        connected.resolve();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [WebSocketModule.forRoot()],
      providers: [ShutdownGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      shutdownTimeoutMs: 200,
    });

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/shutdown`);
    await onceOpen(socket);
    await connected.promise;

    const closed = onceClosed(socket);
    await app.close();
    await closed;

    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it('attaches a socket error listener so websocket error events do not escape', () => {
    const loggerEvents: string[] = [];
    const service = createTestLifecycleService({}, loggerEvents);
    const { emitError, socket } = createMockSocket();
    const state = Reflect.get(service, 'createConnectionHandlerState').call(service) as { socketId: string };

    Reflect.get(service, 'socketRegistry').set(state.socketId, socket);
    Reflect.get(service, 'attachConnectionListeners').call(service, state, socket, {} as IncomingMessage);

    expect(() => emitError(new Error('socket exploded'))).not.toThrow();
    expect(
      loggerEvents.some((event) => event.includes('error:WebSocketGatewayLifecycleService:WebSocket gateway socket emitted an error.:socket exploded')),
    ).toBe(true);
  });
});
