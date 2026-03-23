import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';
import { Inject, Scope } from '@konekti/core';
import { bootstrapNodeApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server as SocketIoServer, Socket } from 'socket.io';

import { createSocketIoModule } from './module.js';
import { SOCKETIO_ROOM_SERVICE, SOCKETIO_SERVER } from './tokens.js';
import type { SocketIoRoomService } from './types.js';

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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
