import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Inject } from '@konekti/core';
import { defineModule } from '@konekti/runtime';
import { bootstrapNodeApplication } from '@konekti/runtime/node';

import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '../decorators.js';
import * as nodePublicApi from './node.js';
import { NodeWebSocketModule, createNodeWebSocketProviders } from './node.js';
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

describe('@konekti/websockets/node', () => {
  it('exposes the explicit Node-only websocket seam', () => {
    expect(nodePublicApi).toHaveProperty('NodeWebSocketModule');
    expect(nodePublicApi).toHaveProperty('NodeWebSocketGatewayLifecycleService');
    expect(nodePublicApi).toHaveProperty('createNodeWebSocketProviders');
  });

  it('wires the Node lifecycle service through the Node-only providers', () => {
    const options: WebSocketModuleOptions = {
      shutdown: { timeoutMs: 1234 },
    };
    const providers = createNodeWebSocketProviders(options);
    const optionsProvider = providers.find(
      (provider) => typeof provider === 'object' && provider !== null && 'useValue' in provider,
    );

    expect(providers).toContain(NodeWebSocketGatewayLifecycleService);
    expect(optionsProvider).toBeDefined();
    expect(optionsProvider).toHaveProperty('useValue', options);
  });

  it('preserves Node-backed websocket behavior through the explicit node seam', async () => {
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
    await onceClosed(socket);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.connectCount).toBe(1);
    expect(state.messages).toEqual([{ value: 'hello' }]);
    expect(state.disconnectCount).toBe(1);

    await app.close();
  });
});
