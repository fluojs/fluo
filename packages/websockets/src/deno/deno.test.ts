import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import type { HttpApplicationAdapter } from '@konekti/http';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as denoPublicApi from './deno.js';
import {
  createDenoWebSocketProviders,
  DenoWebSocketGatewayLifecycleService,
  DenoWebSocketModule,
  type DenoServerWebSocket,
  type DenoWebSocketBinding,
  type DenoWebSocketBindingHost,
  type DenoWebSocketMessage,
  type DenoWebSocketUpgradeResult,
} from './deno.js';

type MockDenoSocketListenerMap = {
  close: Array<(event: Event) => void>;
  error: Array<(event: Event) => void>;
  message: Array<(event: MessageEvent<DenoWebSocketMessage>) => void>;
};

const WEBSOCKET_OPEN_READY_STATE = 1;
const WEBSOCKET_CLOSED_READY_STATE = 3;

class MockDenoSocket implements DenoServerWebSocket {
  readonly #listeners: MockDenoSocketListenerMap = {
    close: [],
    error: [],
    message: [],
  };
  #readyState: number = WEBSOCKET_OPEN_READY_STATE;

  readonly sentMessages: string[] = [];

  get readyState(): number {
    return this.#readyState;
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

    this.#listeners.message.push(callback as (event: MessageEvent<DenoWebSocketMessage>) => void);
  }

  close(code?: number, reason?: string): void {
    this.#readyState = WEBSOCKET_CLOSED_READY_STATE;
    const event = new Event('close') as Event & { code: number; reason: string };
    Object.defineProperties(event, {
      code: { value: code ?? 1000 },
      reason: { value: reason ?? '' },
    });

    for (const listener of this.#listeners.close) {
      listener(event);
    }
  }

  emitError(): void {
    const event = new Event('error');

    for (const listener of this.#listeners.error) {
      listener(event);
    }
  }

  emitMessage(data: DenoWebSocketMessage): void {
    const event = new MessageEvent<DenoWebSocketMessage>('message', { data });

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

    this.removeMessageListener(callback as (event: MessageEvent<DenoWebSocketMessage>) => void);
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

  private removeMessageListener(callback: (event: MessageEvent<DenoWebSocketMessage>) => void): void {
    const index = this.#listeners.message.indexOf(callback);
    if (index >= 0) {
      this.#listeners.message.splice(index, 1);
    }
  }
}

class TestDenoServer {
  lastSocket?: MockDenoSocket;

  constructor(private readonly binding?: DenoWebSocketBinding) {}

  async fetch(request: Request): Promise<Response> {
    if (!this.binding) {
      return new Response(null, { status: 404 });
    }

    return await this.binding.fetch(request, {
      upgrade: () => this.upgrade(),
    });
  }

  upgrade(): DenoWebSocketUpgradeResult<MockDenoSocket> {
    const socket = new MockDenoSocket();
    this.lastSocket = socket;

    return {
      response: new Response(null, { status: 200 }),
      socket,
    };
  }
}

class TestDenoAdapter implements HttpApplicationAdapter, DenoWebSocketBindingHost {
  private binding?: DenoWebSocketBinding;
  private server?: TestDenoServer;

  configureWebSocketBinding(binding: DenoWebSocketBinding | undefined): void {
    this.binding = binding;
  }

  getRealtimeCapability() {
    return {
      contract: 'raw-websocket-expansion' as const,
      kind: 'fetch-style' as const,
      mode: 'request-upgrade' as const,
      reason:
        'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @konekti/websockets/deno for the official raw websocket binding.',
      support: 'supported' as const,
      version: 1 as const,
    };
  }

  getServer(): TestDenoServer | undefined {
    return this.server;
  }

  async listen(): Promise<void> {
    this.server = new TestDenoServer(this.binding);
  }

  async close(): Promise<void> {
    this.server = undefined;
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('@konekti/websockets/deno', () => {
  it('exposes the explicit Deno websocket seam', () => {
    expect(denoPublicApi).toHaveProperty('DenoWebSocketModule');
    expect(denoPublicApi).toHaveProperty('DenoWebSocketGatewayLifecycleService');
    expect(denoPublicApi).toHaveProperty('createDenoWebSocketProviders');
  });

  it('wires the Deno lifecycle service through Deno-only providers', () => {
    const options = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = createDenoWebSocketProviders(options);
    const optionsProvider = providers.find(
      (provider) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(DenoWebSocketGatewayLifecycleService);
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('rejects serverBacked gateway opt-in on the Deno fetch-style binding', async () => {
    const adapter = new TestDenoAdapter();

    @WebSocketGateway({ path: '/chat', serverBacked: { port: 4102 } })
    class ChatGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [DenoWebSocketModule.forRoot()],
      providers: [ChatGateway],
    });

    await expect(
      bootstrapApplication({
        adapter,
        rootModule: AppModule,
      }),
    ).rejects.toThrow('@WebSocketGateway({ serverBacked }) is not supported on @konekti/websockets/deno');
  });

  it('preserves Deno-backed websocket behavior through the explicit deno seam', async () => {
    const adapter = new TestDenoAdapter();

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
      onPing(payload: unknown, socket: DenoServerWebSocket) {
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
      imports: [DenoWebSocketModule.forRoot()],
      providers: [GatewayState, ChatGateway],
    });

    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const state = await app.container.resolve(GatewayState);

    await app.listen();

    const server = adapter.getServer();
    const upgradeResponse = await server?.fetch(new Request('https://runtime.test/chat', {
      headers: { upgrade: 'websocket' },
    }));

    await flushAsyncWork();

    const socket = server?.lastSocket;
    expect(upgradeResponse?.status).toBe(200);
    expect(socket).toBeDefined();

    if (!socket) {
      throw new Error('Expected Deno test socket to be available after websocket upgrade.');
    }

    socket.emitMessage('{"event":"ping","data":{"value":"hello"}}');
    await flushAsyncWork();

    socket.close(1000, 'done');
    await flushAsyncWork();

    expect(state.connectCount).toBe(1);
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(socket.sentMessages).toEqual(['{"event":"pong","data":{"value":"hello"}}']);
    expect(state.disconnectCount).toBe(1);

    await app.close();
  });
});
