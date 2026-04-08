import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import type { HttpApplicationAdapter } from '@konekti/http';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as bunPublicApi from './bun.js';
import {
  BunWebSocketGatewayLifecycleService,
  BunWebSocketModule,
  createBunWebSocketProviders,
  type BunServerLike,
  type BunServerWebSocket,
  type BunWebSocketBinding,
  type BunWebSocketBindingHost,
  type BunWebSocketMessage,
} from './bun.js';

type MockSocket = BunServerWebSocket<unknown> & {
  sentMessages: string[];
};

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
        'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @konekti/websocket/bun for the official raw websocket binding.',
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

    const socket = createMockSocket(options?.data);
    this.lastSocket = socket;
    void Promise.resolve(this.binding.websocket.open?.(socket));
    return true;
  }
}

function createMockSocket(data: unknown): MockSocket {
  const subscriptions = new Set<string>();
  const socket: MockSocket = {
    close() {},
    cork(callback: (target: BunServerWebSocket<unknown>) => void) {
      callback(socket);
    },
    data,
    isSubscribed(topic: string) {
      return subscriptions.has(topic);
    },
    publish() {},
    readyState: 1,
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

describe('@konekti/websocket/bun', () => {
  it('exposes the explicit Bun websocket seam', () => {
    expect(bunPublicApi).toHaveProperty('BunWebSocketModule');
    expect(bunPublicApi).toHaveProperty('BunWebSocketGatewayLifecycleService');
    expect(bunPublicApi).toHaveProperty('createBunWebSocketProviders');
  });

  it('wires the Bun lifecycle service through Bun-only providers', () => {
    const options = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = createBunWebSocketProviders(options);
    const optionsProvider = providers.find(
      (provider) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(BunWebSocketGatewayLifecycleService);
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('preserves Bun-backed websocket behavior through the explicit bun seam', async () => {
    const adapter = new TestBunAdapter();

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
    const state = await app.container.resolve(GatewayState);

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
});
