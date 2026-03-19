import { createConnection, createServer } from 'node:net';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Inject, Scope } from '@konekti/core';
import { bootstrapApplication, bootstrapNodeApplication, defineModule, type ApplicationLogger, HTTP_APPLICATION_ADAPTER } from '@konekti/runtime';
import type { HttpApplicationAdapter } from '@konekti/http';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from './decorators.js';
import { getWebSocketGatewayMetadata, getWebSocketHandlerMetadataEntries } from './metadata.js';
import { createWebSocketModule } from './module.js';

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

describe('@konekti/websocket', () => {
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
      imports: [createWebSocketModule()],
      providers: [RequestGateway],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      mode: 'test',
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
      imports: [createWebSocketModule()],
      providers: [GatewayState, DedupeGateway, { provide: ALIAS_TOKEN, useClass: DedupeGateway }],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      mode: 'test',
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
      imports: [createWebSocketModule()],
      providers: [ChatGateway],
    });

    await expect(
      bootstrapApplication({
        adapter: {
          async close() {},
          async listen() {},
        },
        mode: 'test',
        rootModule: AppModule,
      }),
    ).rejects.toThrow('WebSocket gateway bootstrap requires an HTTP adapter with getServer()');
  });

  it('exposes a Node server through the runtime adapter token', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [createWebSocketModule()],
    });

    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      mode: 'test',
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
      imports: [createWebSocketModule()],
      providers: [GatewayState, ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      mode: 'test',
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

  it('does not deliver messages or disconnects that arrive before async onConnect completes', async () => {
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
      imports: [createWebSocketModule()],
      providers: [GatewayState, AsyncGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      mode: 'test',
      port,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    // Connect, send a message, then close — all before onConnect resolves.
    // message and close listeners are registered only after onConnect completes,
    // so these events are not delivered to the gateway handlers.
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/async-connect`);
    await onceOpen(socket);
    socket.send(JSON.stringify({ event: 'ping', data: 'early' }));
    socket.close();
    await onceClosed(socket);

    connected.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.messages).toEqual([]);
    expect(state.disconnects).toBe(0);

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
      imports: [createWebSocketModule()],
      providers: [GatewayState, AsyncGateway2],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      mode: 'test',
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

  it('rejects websocket upgrade requests for unmatched gateway paths', async () => {
    @WebSocketGateway({ path: '/chat' })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createWebSocketModule()],
      providers: [ChatGateway],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      mode: 'test',
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
      imports: [createWebSocketModule()],
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

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/shutdown`);
    await onceOpen(socket);
    await connected.promise;

    const closed = onceClosed(socket);
    await app.close();
    await closed;

    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
