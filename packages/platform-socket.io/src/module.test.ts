import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';
import { Inject, Scope } from '@konekti/core';
import { bootstrapNodeApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server as SocketIoServer, Socket } from 'socket.io';

import { createSocketIoModule } from './module.js';
import { SocketIoLifecycleService } from './adapter.js';
import { SOCKETIO_ROOM_SERVICE, SOCKETIO_SERVER } from './tokens.js';
import type { SocketIoRoomService } from './types.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

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

function onceConnected(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
}

function onceEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

function onceDisconnected(socket: ClientSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once('disconnect', (reason) => resolve(reason));
  });
}

describe('@konekti/platform-socket.io', () => {
  it('injects the Socket.IO server token into singleton providers', async () => {
    @Inject([SOCKETIO_SERVER])
    class ServerProbe {
      constructor(public readonly server: SocketIoServer) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createSocketIoModule()],
      providers: [ServerProbe],
    });

    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port: await findAvailablePort(),
    });
    const probe = await app.container.resolve(ServerProbe);

    expect(probe.server).toBeDefined();

    await app.close();
  });

  it('boots a real Node app and handles connect, message, room broadcast, and disconnect', async () => {
    class GatewayState {
      connectCount = 0;
      disconnectCount = 0;
      disconnectReason: string | undefined;
      lastSocketId: string | undefined;
      messages: unknown[] = [];
    }

    @Inject([GatewayState, SOCKETIO_ROOM_SERVICE])
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      constructor(
        private readonly state: GatewayState,
        private readonly rooms: SocketIoRoomService,
      ) {}

      @OnConnect()
      onConnect(socket: Socket) {
        this.state.connectCount += 1;
        this.state.lastSocketId = socket.id;
        this.rooms.joinRoom(socket.id, 'room:chat');
      }

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
        this.rooms.broadcastToRoom('room:chat', 'room:pong', payload);
      }

      @OnDisconnect()
      onDisconnect(_socket: Socket, reason: string) {
        this.state.disconnectCount += 1;
        this.state.disconnectReason = reason;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createSocketIoModule({ transports: ['websocket'] })],
      providers: [GatewayState, ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);
    const roomService = await app.container.resolve<SocketIoRoomService>(SOCKETIO_ROOM_SERVICE);

    await app.listen();

    const socket = createClient(`http://127.0.0.1:${String(port)}/chat`, {
      reconnection: false,
      transports: ['websocket'],
    });
    await onceConnected(socket);

    socket.emit('ping', { value: 'hello' });
    const broadcast = await onceEvent<{ value: string }>(socket, 'room:pong');

    expect(broadcast).toEqual({ value: 'hello' });
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(state.connectCount).toBe(1);
    expect(state.lastSocketId).toBeDefined();
    expect(roomService.getRooms(state.lastSocketId!)).toEqual(new Set([state.lastSocketId!, 'room:chat']));

    const disconnected = onceDisconnected(socket);
    socket.disconnect();

    expect(await disconnected).toBe('io client disconnect');

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.disconnectCount).toBe(1);
    expect(state.disconnectReason).toBe('client namespace disconnect');

    await app.close();
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
      imports: [createSocketIoModule()],
      providers: [RequestGateway],
    });

    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      logger: createLogger(loggerEvents),
      port: await findAvailablePort(),
    });

    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:SocketIoLifecycleService:RequestGateway in module AppModule declares @WebSocketGateway() but is registered with request scope.',
        ),
      ),
    ).toBe(true);

    await app.close();
  });

  it('buffers messages and disconnects until async connect handlers complete', async () => {
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
      imports: [createSocketIoModule({ transports: ['websocket'] })],
      providers: [GatewayState, AsyncGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const socket = createClient(`http://127.0.0.1:${String(port)}/async-connect`, {
      reconnection: false,
      transports: ['websocket'],
    });
    await onceConnected(socket);

    const disconnected = onceDisconnected(socket);
    socket.emit('ping', 'early');
    socket.disconnect();
    await disconnected;

    connected.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.messages).toEqual(['early']);
    expect(state.disconnects).toBe(1);

    await app.close();
  });

  it('drops oldest pre-connect socket.io messages once the pending buffer limit is reached', () => {
    const loggerEvents: string[] = [];
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger(loggerEvents),
      {
        async close() {},
        getServer() {
          return {};
        },
      } as never,
      {
        buffer: {
          maxPendingMessagesPerSocket: 2,
          overflowPolicy: 'drop-oldest',
        },
        transports: ['websocket'],
      },
    );
    const listeners: {
      disconnect?: (reason: string, description: unknown) => void;
      onAny?: (event: string, ...args: unknown[]) => void;
    } = {};
    const socket = {
      id: 'socket-1',
      disconnect: () => undefined,
      on(event: 'disconnect', listener: (reason: string, description: unknown) => void) {
        listeners.disconnect = listener;
        return this;
      },
      onAny(listener: (event: string, ...args: unknown[]) => void) {
        listeners.onAny = listener;
        return this;
      },
    } as unknown as Socket;
    const state = Reflect.get(service, 'createConnectionHandlerState').call(service) as {
      bufferedMessages: Array<{ event: string; payload: unknown }>;
    };

    Reflect.get(service, 'attachConnectionListeners').call(service, state, [], socket, {} as never);

    listeners.onAny?.('ping', 'one');
    listeners.onAny?.('ping', 'two');
    listeners.onAny?.('ping', 'three');

    expect(state.bufferedMessages.map((message) => message.payload)).toEqual(['two', 'three']);
    expect(loggerEvents.some((event) => event.includes('dropped the oldest pending message'))).toBe(true);
  });

  it('removes errored sockets from the registry and logs the error', () => {
    const loggerEvents: string[] = [];
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger(loggerEvents),
      {
        async close() {},
        getServer() {
          return {};
        },
      } as never,
      {
        transports: ['websocket'],
      },
    );
    const listeners: {
      disconnect?: (reason: string, description: unknown) => void;
      error?: (error: Error) => void;
      onAny?: (event: string, ...args: unknown[]) => void;
    } = {};
    const socket = {
      id: 'socket-1',
      disconnect: () => undefined,
      on(event: 'disconnect' | 'error', listener: ((reason: string, description: unknown) => void) | ((error: Error) => void)) {
        if (event === 'disconnect') {
          listeners.disconnect = listener as (reason: string, description: unknown) => void;
        } else {
          listeners.error = listener as (error: Error) => void;
        }
        return this;
      },
      onAny(listener: (event: string, ...args: unknown[]) => void) {
        listeners.onAny = listener;
        return this;
      },
    } as unknown as Socket;
    const state = Reflect.get(service, 'createConnectionHandlerState').call(service);
    const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, Socket>;

    socketRegistry.set(socket.id, socket);
    Reflect.get(service, 'attachConnectionListeners').call(service, state, [], socket, {} as never);

    listeners.error?.(new Error('socket exploded'));

    expect(socketRegistry.has(socket.id)).toBe(false);
    expect(loggerEvents).toContain('error:SocketIoLifecycleService:Socket.IO gateway socket emitted an error.:socket exploded');
  });

  it('waits for disconnect handlers to settle before removing the socket from the registry', async () => {
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger([]),
      {
        async close() {},
        getServer() {
          return {};
        },
      } as never,
      {
        transports: ['websocket'],
      },
    );
    const deferred = createDeferred<void>();
    const listeners: {
      disconnect?: (reason: string, description: unknown) => void;
      onAny?: (event: string, ...args: unknown[]) => void;
    } = {};
    const socket = {
      id: 'socket-1',
      disconnect: () => undefined,
      on(event: 'disconnect', listener: (reason: string, description: unknown) => void) {
        listeners.disconnect = listener;
        return this;
      },
      onAny(listener: (event: string, ...args: unknown[]) => void) {
        listeners.onAny = listener;
        return this;
      },
    } as unknown as Socket;
    const state = Reflect.get(service, 'createConnectionHandlerState').call(service);
    const socketRegistry = Reflect.get(service, 'socketRegistry') as Map<string, Socket>;
    let disconnectHandled = false;

    Reflect.set(service, 'handleDisconnect', async () => {
      disconnectHandled = true;
      await deferred.promise;
    });

    state.handlersReady = true;
    socketRegistry.set(socket.id, socket);
    Reflect.get(service, 'attachConnectionListeners').call(service, state, [], socket, {} as never);

    listeners.disconnect?.('client namespace disconnect', undefined);
    await Promise.resolve();

    expect(disconnectHandled).toBe(true);
    expect(socketRegistry.has(socket.id)).toBe(true);

    deferred.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(socketRegistry.has(socket.id)).toBe(false);
  });

  it('isolates same room names across namespaces', async () => {
    class GatewayState {
      adminMessages: unknown[] = [];
      chatMessages: unknown[] = [];
    }

    @Inject([GatewayState, SOCKETIO_ROOM_SERVICE])
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      constructor(
        private readonly state: GatewayState,
        private readonly rooms: SocketIoRoomService,
      ) {}

      @OnConnect()
      onConnect(socket: Socket) {
        this.rooms.joinRoom(socket.id, 'shared-room');
      }

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.chatMessages.push(payload);
        this.rooms.broadcastToRoom('shared-room', 'chat:broadcast', payload);
      }
    }

    @Inject([GatewayState, SOCKETIO_ROOM_SERVICE])
    @WebSocketGateway({ path: '/admin' })
    class AdminGateway {
      constructor(
        private readonly state: GatewayState,
        private readonly rooms: SocketIoRoomService,
      ) {}

      @OnConnect()
      onConnect(socket: Socket) {
        this.rooms.joinRoom(socket.id, 'shared-room');
      }

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.adminMessages.push(payload);
        this.rooms.broadcastToRoom('shared-room', 'admin:broadcast', payload);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createSocketIoModule({ transports: ['websocket'] })],
      providers: [GatewayState, ChatGateway, AdminGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const chatSocket = createClient(`http://127.0.0.1:${String(port)}/chat`, {
      reconnection: false,
      transports: ['websocket'],
    });
    const adminSocket = createClient(`http://127.0.0.1:${String(port)}/admin`, {
      reconnection: false,
      transports: ['websocket'],
    });

    await Promise.all([onceConnected(chatSocket), onceConnected(adminSocket)]);

    const chatBroadcast = onceEvent<string>(chatSocket, 'chat:broadcast');
    let adminReceivedChatBroadcast = false;
    adminSocket.once('chat:broadcast', () => {
      adminReceivedChatBroadcast = true;
    });

    chatSocket.emit('ping', 'chat-message');

    expect(await chatBroadcast).toBe('chat-message');
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(adminReceivedChatBroadcast).toBe(false);
    expect(state.chatMessages).toEqual(['chat-message']);
    expect(state.adminMessages).toEqual([]);

    const chatDisconnected = onceDisconnected(chatSocket);
    const adminDisconnected = onceDisconnected(adminSocket);
    chatSocket.disconnect();
    adminSocket.disconnect();
    await Promise.all([chatDisconnected, adminDisconnected]);

    await app.close();
  });

  it('requires an explicit namespace when room helpers are used outside gateway handler context', async () => {
    @WebSocketGateway({ path: '/' })
    class DefaultGateway {
      @OnConnect()
      onConnect() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createSocketIoModule({ transports: ['websocket'] })],
      providers: [DefaultGateway],
    });

    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port: await findAvailablePort(),
    });
    const rooms = await app.container.resolve<SocketIoRoomService>(SOCKETIO_ROOM_SERVICE);

    await app.listen();

    expect(() => rooms.broadcastToRoom('shared-room', 'chat:broadcast', 'payload')).toThrow(/namespace/i);
    expect(() => rooms.joinRoom('missing-socket', 'shared-room')).toThrow(/namespace/i);
    expect(() => rooms.leaveRoom('missing-socket', 'shared-room')).toThrow(/namespace/i);
    expect(() => rooms.broadcastToRoom('shared-room', 'chat:broadcast', 'payload', '/')).not.toThrow();

    await app.close();
  });

  it('closes active socket.io clients during application shutdown', async () => {
    @WebSocketGateway({ path: '/shutdown' })
    class ShutdownGateway {
      @OnConnect()
      onConnect() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createSocketIoModule()],
      providers: [ShutdownGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      shutdownTimeoutMs: 200,
    });

    await app.listen();

    const socket = createClient(`http://127.0.0.1:${String(port)}/shutdown`, {
      reconnection: false,
      transports: ['websocket'],
    });
    await onceConnected(socket);

    const disconnected = onceDisconnected(socket);
    await app.close();

    expect(['server shutting down', 'transport close']).toContain(await disconnected);
  });
});
