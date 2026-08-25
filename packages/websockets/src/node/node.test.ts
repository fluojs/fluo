import type { AddressInfo } from 'node:net';
import { Inject } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { createNodeHttpAdapter } from '@fluojs/runtime/node';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as nodePublicApi from './node.js';
import { NodeWebSocketGatewayLifecycleService, NodeWebSocketModule } from './node.js';
import type { WebSocketModuleOptions } from './node-types.js';

function getBoundPort(server: unknown): number {
  if (!server || typeof (server as { address?: unknown }).address !== 'function') {
    throw new Error('Failed to resolve a bound test server.');
  }

  const address = (server as { address(): AddressInfo | string | null }).address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve a bound test port.');
  }

  return address.port;
}

function getAdapterPort(adapter: { getServer?: () => unknown }): number {
  return getBoundPort(adapter.getServer?.());
}

function hasUpgradeEventListener(server: unknown): server is {
  once(event: 'upgrade', listener: () => void): unknown;
} {
  return typeof server === 'object'
    && server !== null
    && 'once' in server
    && typeof server.once === 'function';
}

function hasApplicationShutdown(service: unknown): service is {
  onApplicationShutdown(): Promise<void>;
} {
  return typeof service === 'object'
    && service !== null
    && 'onApplicationShutdown' in service
    && typeof service.onApplicationShutdown === 'function';
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
    const lifecycleProvider = providers.find(
      (provider: unknown) =>
        typeof provider === 'object'
        && provider !== null
        && 'provide' in provider
        && provider.provide === NodeWebSocketGatewayLifecycleService,
    );

    expect(lifecycleProvider).toBeDefined();
    expect(lifecycleProvider).toHaveProperty('useClass');
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

    const adapter = createNodeHttpAdapter({ port: 0 });
    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const state = await app.container.resolve(GatewayState);

    try {
      await app.listen();
      const port = getAdapterPort(adapter);

      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
      try {
        await onceOpen(socket);
        socket.send(JSON.stringify({ event: 'ping', data: { value: 'hello' } }));

        const incoming = await onceMessage(socket);
        expect(JSON.parse(incoming)).toEqual({ event: 'pong', data: { value: 'hello' } });

        socket.close();
        await Promise.all([onceClosed(socket), disconnected.promise]);

        expect(state.connectCount).toBe(1);
        expect(state.messages).toEqual([{ value: 'hello' }]);
        expect(state.disconnectCount).toBe(1);
      } finally {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
    } finally {
      await app.close();
    }
  });

  it('receives Node Buffer binary event envelopes through the explicit node seam', async () => {
    const handled = createDeferred<void>();
    class GatewayState {
      messages: unknown[] = [];
    }

    @Inject(GatewayState)
    @WebSocketGateway({ path: '/buffer-event' })
    class BufferGateway {
      constructor(private readonly state: GatewayState) {}

      @OnMessage('ping')
      onPing(payload: unknown) {
        this.state.messages.push(payload);
        handled.resolve();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot()],
      providers: [GatewayState, BufferGateway],
    });

    const adapter = createNodeHttpAdapter({ port: 0 });
    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const state = await app.container.resolve(GatewayState);

    try {
      await app.listen();
      const port = getAdapterPort(adapter);

      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/buffer-event`);
      try {
        await onceOpen(socket);
        socket.send(Buffer.from(JSON.stringify({ event: 'ping', data: { value: 'buffer-node' } })));

        await handled.promise;
        expect(state.messages).toEqual([{ value: 'buffer-node' }]);
      } finally {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
    } finally {
      await app.close();
    }
  });

  it('rejects a no-guard Node upgrade when shutdown starts immediately before acceptance', async () => {
    @WebSocketGateway({ path: '/shutdown-admission-race' })
    class ShutdownGateway {}

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot({ shutdown: { timeoutMs: 500 } })],
      providers: [ShutdownGateway],
    });

    const adapter = createNodeHttpAdapter({ port: 0 });
    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const service = await app.container.resolve(NodeWebSocketGatewayLifecycleService);
    let shutdownPromise: Promise<void> | undefined;

    try {
      await app.listen();
      const server = adapter.getServer?.();

      if (!hasUpgradeEventListener(server)) {
        throw new Error('Expected Node test server to be available after application listen.');
      }

      if (!hasApplicationShutdown(service)) {
        throw new Error('Expected Node websocket lifecycle service to expose application shutdown.');
      }

      server.once('upgrade', () => {
        shutdownPromise = service.onApplicationShutdown();
      });

      const port = getAdapterPort(adapter);
      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/shutdown-admission-race`);

      try {
        const upgradeOutcome = await new Promise<number | 'accepted'>((resolve, reject) => {
          socket.once('open', () => resolve('accepted'));
          socket.once('unexpected-response', (_request, response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          });
          socket.once('error', reject);
        });

        expect(upgradeOutcome).toBe(503);

        if (!shutdownPromise) {
          throw new Error('Expected websocket shutdown to start during upgrade admission.');
        }

        await shutdownPromise;
      } finally {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
    } finally {
      await app.close();
    }
  });

  it('waits for disconnect cleanup when a socket closes during shutdown drain', async () => {
    const disconnectStarted = createDeferred<void>();
    const disconnectRelease = createDeferred<void>();

    @WebSocketGateway({ path: '/shutdown' })
    class ShutdownGateway {
      @OnDisconnect()
      async onDisconnect() {
        disconnectStarted.resolve();
        await disconnectRelease.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot({ shutdown: { timeoutMs: 500 } })],
      providers: [ShutdownGateway],
    });

    const adapter = createNodeHttpAdapter({ port: 0 });
    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });

    try {
      await app.listen();
      const port = getAdapterPort(adapter);

      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/shutdown`);
      try {
        await onceOpen(socket);

        const closed = onceClosed(socket);
        socket.close();
        await disconnectStarted.promise;

        let appCloseSettled = false;
        const appClose = app.close().then(() => {
          appCloseSettled = true;
        });

        await Promise.resolve();

        expect(appCloseSettled).toBe(false);

        disconnectRelease.resolve();
        await Promise.all([closed, appClose]);
      } finally {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
    } finally {
      disconnectRelease.resolve();
      await app.close();
    }
  });

  it('sends opt-in Node handler replies with the connection identity', async () => {
    // Given
    const socketIds: string[] = [];
    @WebSocketGateway({ path: '/replies' })
    class ReplyGateway {
      @OnMessage('ping')
      onPing(payload: unknown, _socket: WebSocket, _request: unknown, socketId: string) {
        socketIds.push(socketId);
        return { data: payload, event: 'pong' };
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [NodeWebSocketModule.forRoot({ replies: { mode: 'event-envelope' } })],
      providers: [ReplyGateway],
    });
    const adapter = createNodeHttpAdapter({ port: 0 });
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });
    await app.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${String(getAdapterPort(adapter))}/replies`);

    try {
      await onceOpen(socket);
      const reply = onceMessage(socket);

      // When
      socket.send(JSON.stringify({ data: 'value', event: 'ping' }));

      // Then
      await expect(reply).resolves.toBe(JSON.stringify({ data: 'value', event: 'pong' }));
      expect(socketIds).toHaveLength(1);
      expect(socketIds[0]).not.toBe('');
    } finally {
      socket.close();
      await app.close();
    }
  });
});
