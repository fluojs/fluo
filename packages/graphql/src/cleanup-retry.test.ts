import { Inject, Scope } from '@fluojs/core';
import type { Application } from '@fluojs/runtime';
import { defineModule } from '@fluojs/runtime';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Resolver, Subscription } from './decorators.js';
import { GraphqlModule } from './module.js';

type GraphqlWebSocketMessage = {
  id?: string;
  payload?: {
    data?: Record<string, unknown>;
    errors?: Array<{ message?: string }>;
  };
  type: string;
};

async function resolveListeningPort(app: Application): Promise<number> {
  const adapter = await app.get(HTTP_APPLICATION_ADAPTER);
  const server = adapter.getServer?.() as { address?: () => unknown } | undefined;
  const address = server?.address?.();

  if (!address || typeof address !== 'object' || !('port' in address)) {
    throw new Error('Failed to resolve the listening port of the bootstrapped application.');
  }

  return (address as { port: number }).port;
}

function onceGraphqlWebSocketMessage(socket: WebSocket): Promise<GraphqlWebSocketMessage> {
  return new Promise((resolve, reject) => {
    const handleClose = (code: number, reason: Buffer) => {
      reject(new Error(`WebSocket closed before message: ${String(code)} ${reason.toString('utf8')}`));
    };
    const handleMessage = (data: unknown) => {
      socket.off('close', handleClose);

      if (typeof data === 'string') {
        resolve(JSON.parse(data) as GraphqlWebSocketMessage);
        return;
      }

      if (data instanceof ArrayBuffer) {
        resolve(JSON.parse(Buffer.from(data).toString('utf8')) as GraphqlWebSocketMessage);
        return;
      }

      if (ArrayBuffer.isView(data)) {
        resolve(
          JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')) as GraphqlWebSocketMessage,
        );
        return;
      }

      reject(new Error(`Unsupported websocket message payload: ${String(data)}`));
    };

    socket.once('close', handleClose);
    socket.once('error', reject);
    socket.once('message', handleMessage);
  });
}

function readGraphqlWebSocketMessages(socket: WebSocket, count: number): Promise<GraphqlWebSocketMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: GraphqlWebSocketMessage[] = [];
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`WebSocket closed before collecting ${String(count)} messages: ${String(code)} ${reason.toString('utf8')}`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleMessage = (data: unknown) => {
      if (typeof data === 'string') {
        messages.push(JSON.parse(data) as GraphqlWebSocketMessage);
      } else if (data instanceof ArrayBuffer) {
        messages.push(JSON.parse(Buffer.from(data).toString('utf8')) as GraphqlWebSocketMessage);
      } else if (ArrayBuffer.isView(data)) {
        messages.push(
          JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')) as GraphqlWebSocketMessage,
        );
      } else {
        cleanup();
        reject(new Error(`Unsupported websocket message payload: ${String(data)}`));
        return;
      }

      if (messages.length === count) {
        cleanup();
        resolve(messages);
      }
    };
    const cleanup = () => {
      socket.off('close', handleClose);
      socket.off('error', handleError);
      socket.off('message', handleMessage);
    };

    socket.on('close', handleClose);
    socket.on('error', handleError);
    socket.on('message', handleMessage);
  });
}

async function connectGraphqlWebSocket(port: number): Promise<WebSocket> {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const openedSocket = new WebSocket(`ws://127.0.0.1:${String(port)}/graphql`, 'graphql-transport-ws');

    openedSocket.once('open', () => resolve(openedSocket));
    openedSocket.once('error', reject);
  });
  const acknowledgement = onceGraphqlWebSocketMessage(socket);

  socket.send(JSON.stringify({ type: 'connection_init' }));
  await expect(acknowledgement).resolves.toEqual({ type: 'connection_ack' });

  return socket;
}

function onceWebSocketClosed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
  });
}

describe('GraphQL cleanup retry ownership', () => {
  it('creates a fresh websocket operation scope when completed cleanup fails for the same operation id', async () => {
    let createdScopes = 0;
    let destroyAttempts = 0;

    @Inject()
    @Scope('request')
    class RetriedOperationScope {
      readonly id = ++createdScopes;

      onDestroy(): void {
        destroyAttempts += 1;

        if (destroyAttempts === 1) {
          throw new Error('first operation cleanup fails');
        }
      }
    }

    @Inject(RetriedOperationScope)
    @Scope('request')
    @Resolver('RetriedOperationResolver')
    class RetriedOperationResolver {
      constructor(private readonly scope: RetriedOperationScope) {}

      @Subscription()
      async *scopeId(): AsyncGenerator<string, void, void> {
        yield String(this.scope.id);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRoot({
          resolvers: [RetriedOperationResolver],
          subscriptions: {
            websocket: {
              enabled: true,
            },
          },
        }),
      ],
      providers: [RetriedOperationScope, RetriedOperationResolver],
    });

    const app = await bootstrapNodeApplication(AppModule, { cors: false, port: 0 });

    await app.listen();

    const port = await resolveListeningPort(app);

    const socket = await connectGraphqlWebSocket(port);
    const firstMessages = readGraphqlWebSocketMessages(socket, 2);
    socket.send(JSON.stringify({
      id: 'retryable-operation',
      payload: {
        query: 'subscription { scopeId }',
      },
      type: 'subscribe',
    }));
    await expect(firstMessages).resolves.toEqual([
      {
        id: 'retryable-operation',
        payload: {
          data: {
            scopeId: '1',
          },
        },
        type: 'next',
      },
      {
        id: 'retryable-operation',
        type: 'complete',
      },
    ]);

    const secondMessages = readGraphqlWebSocketMessages(socket, 2);
    socket.send(JSON.stringify({
      id: 'retryable-operation',
      payload: {
        query: 'subscription { scopeId }',
      },
      type: 'subscribe',
    }));
    await expect(secondMessages).resolves.toEqual([
      {
        id: 'retryable-operation',
        payload: {
          data: {
            scopeId: '2',
          },
        },
        type: 'next',
      },
      {
        id: 'retryable-operation',
        type: 'complete',
      },
    ]);

    const closed = onceWebSocketClosed(socket);
    socket.close();
    await closed;
    await expect(app.close()).resolves.toBeUndefined();
    expect(destroyAttempts).toBe(3);
  });
});
