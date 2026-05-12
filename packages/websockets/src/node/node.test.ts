import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Inject } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as nodePublicApi from './node.js';
import { NodeWebSocketModule } from './node.js';
import { NodeWebSocketGatewayLifecycleService } from './node-service.js';
import type { WebSocketModuleOptions } from './node-types.js';

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

type ReflectedNodeConnectionState = {
  connectLifecycleSettled: boolean;
  handlersReady: boolean;
  socketId: string;
};

describe('@fluojs/websockets/node', () => {
  it('exposes the explicit Node-only websocket seam', () => {
    expect(nodePublicApi).toHaveProperty('NodeWebSocketModule');
    expect(nodePublicApi).toHaveProperty('NodeWebSocketGatewayLifecycleService');
    expect(nodePublicApi).not.toHaveProperty('createNodeWebSocketProviders');
  });

  it('wires the Node lifecycle service through the Node-only providers', () => {
    const options: WebSocketModuleOptions = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = getModuleMetadata(NodeWebSocketModule.forRoot(options))?.providers ?? [];
    const optionsProvider = providers.find(
      (provider: unknown) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(NodeWebSocketGatewayLifecycleService);
    expect(optionsProvider).toBeDefined();
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('preserves Node-backed websocket behavior through the explicit node seam', async () => {
    const disconnected = createDeferred<void>();

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
      onPing(payload: unknown, socket: WebSocket) {
        this.state.messages.push(payload);
        socket.send(JSON.stringify({ event: 'pong', data: payload }));
      }

      @OnDisconnect()
      onDisconnect() {
        this.state.disconnectCount += 1;
        disconnected.resolve();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot()],
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
    await Promise.all([onceClosed(socket), disconnected.promise]);

    expect(state.connectCount).toBe(1);
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(state.disconnectCount).toBe(1);

    await app.close();
  });

  it('waits for client-closed sockets to finish async disconnect cleanup during shutdown', async () => {
    const cleanupRelease = createDeferred<void>();
    const cleanupStarted = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown-client-closed' })
    class ShutdownGateway {
      @OnDisconnect()
      async onDisconnect() {
        cleanupStarted.resolve();
        await cleanupRelease.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot({ shutdown: { timeoutMs: 200 } })],
      providers: [ShutdownGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/shutdown-client-closed`);
    await onceOpen(socket);

    socket.close();
    await Promise.all([onceClosed(socket), cleanupStarted.promise]);

    let closeFinished = false;
    const closePromise = app.close().then(() => {
      closeFinished = true;
    });

    await delay(20);
    expect(closeFinished).toBe(false);

    cleanupRelease.resolve();
    await closePromise;
    expect(closeFinished).toBe(true);
  });

  it('terminates Node sockets that do not finish the shutdown close handshake', async () => {
    @WebSocketGateway({ path: '/shutdown-terminate-fallback' })
    class ShutdownGateway {
      @OnConnect()
      onConnect() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot({ shutdown: { timeoutMs: 10 } })],
      providers: [ShutdownGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const lifecycle = await app.container.resolve(NodeWebSocketGatewayLifecycleService);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/shutdown-terminate-fallback`);
    await onceOpen(socket);

    const serverSockets = Reflect.get(lifecycle, 'socketRegistry') as Map<string, WebSocket>;
    const serverSocket = [...serverSockets.values()][0];

    if (!serverSocket) {
      throw new Error('Expected server-side websocket to be tracked.');
    }

    const terminate = serverSocket.terminate.bind(serverSocket);
    let closeCallCount = 0;
    let terminateCallCount = 0;
    Reflect.set(serverSocket, 'close', () => {
      closeCallCount += 1;
    });
    Reflect.set(serverSocket, 'terminate', () => {
      terminateCallCount += 1;
      terminate();
    });

    await app.close();

    expect(closeCallCount).toBe(1);
    expect(terminateCallCount).toBe(1);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it('prunes Node connection handler state after normal disconnect cleanup', async () => {
    const disconnected = createDeferred<void>();

    @WebSocketGateway({ path: '/state-prune' })
    class StatePruneGateway {
      @OnDisconnect()
      onDisconnect() {
        disconnected.resolve();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot()],
      providers: [StatePruneGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });
    const lifecycle = await app.container.resolve(NodeWebSocketGatewayLifecycleService);

    await app.listen();

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/state-prune`);
    await onceOpen(socket);
    expect(Reflect.get(lifecycle, 'socketStates')).toHaveProperty('size', 1);

    socket.close();
    await Promise.all([onceClosed(socket), disconnected.promise]);
    await delay(0);

    expect(Reflect.get(lifecycle, 'socketStates')).toHaveProperty('size', 0);

    await app.close();
  });

  it('prunes Node connection state when open lifecycle fails before close delivery', async () => {
    const lifecycle = Object.create(NodeWebSocketGatewayLifecycleService.prototype) as NodeWebSocketGatewayLifecycleService;
    const socket = new EventEmitter();
    const state = Reflect.get(lifecycle, 'createConnectionHandlerState').call(lifecycle) as ReflectedNodeConnectionState;

    Reflect.set(lifecycle, 'socketRegistry', new Map([[state.socketId, socket]]));
    Reflect.set(lifecycle, 'socketStates', new Map([[state.socketId, state]]));
    Reflect.set(lifecycle, 'socketRooms', new Map());
    Reflect.set(lifecycle, 'roomSockets', new Map());
    Reflect.set(lifecycle, 'pingPending', new Set());
    Reflect.set(lifecycle, 'pingSentAt', new Map());
    Reflect.get(lifecycle, 'attachConnectionListeners').call(lifecycle, state, socket, {} as IncomingMessage);
    Reflect.get(lifecycle, 'settleConnectLifecycle').call(lifecycle, state);

    socket.emit('close', 1006, Buffer.from('late close'));

    expect(Reflect.get(lifecycle, 'socketStates')).toHaveProperty('size', 0);
  });
});
