import { createServer } from 'node:net';

import { Inject, Scope } from '@fluojs/core';
import { defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Query, Resolver, Subscription } from './decorators.js';
import { GraphqlModule } from './module.js';

type GraphqlWebSocketMessage = {
  id?: string;
  payload?: {
    data?: Record<string, unknown>;
  };
  type: string;
};

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

      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function postGraphql(port: number, query: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/graphql`, {
    body: JSON.stringify({ query }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  return await response.json();
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
  const acknowledgement = readGraphqlWebSocketMessages(socket, 1);

  socket.send(JSON.stringify({ type: 'connection_init' }));
  await expect(acknowledgement).resolves.toEqual([{ type: 'connection_ack' }]);

  return socket;
}

function onceWebSocketClosed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
  });
}

describe('GraphQL teardown error aggregation', () => {
  it('reports HTTP and websocket cleanup failures together and retries their owners', async () => {
    let cleanupShouldFail = true;

    @Inject()
    @Scope('request')
    class HttpCleanupFailure {
      onDestroy(): void {
        if (cleanupShouldFail) {
          throw new Error('HTTP operation cleanup failed');
        }
      }
    }

    @Inject()
    @Scope('request')
    class WebSocketCleanupFailure {
      onDestroy(): void {
        if (cleanupShouldFail) {
          throw new Error('websocket operation cleanup failed');
        }
      }
    }

    @Inject(HttpCleanupFailure)
    @Scope('request')
    @Resolver('HttpCleanupFailureResolver')
    class HttpCleanupFailureResolver {
      constructor(private readonly cleanupFailure: HttpCleanupFailure) {}

      @Query()
      httpCleanup(): string {
        return this.cleanupFailure.constructor.name;
      }
    }

    @Inject(WebSocketCleanupFailure)
    @Scope('request')
    @Resolver('WebSocketCleanupFailureResolver')
    class WebSocketCleanupFailureResolver {
      constructor(private readonly cleanupFailure: WebSocketCleanupFailure) {}

      @Subscription()
      async *websocketCleanup(): AsyncGenerator<string, void, void> {
        yield this.cleanupFailure.constructor.name;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRoot({
          resolvers: [HttpCleanupFailureResolver, WebSocketCleanupFailureResolver],
          subscriptions: {
            websocket: {
              enabled: true,
            },
          },
        }),
      ],
      providers: [
        HttpCleanupFailure,
        WebSocketCleanupFailure,
        HttpCleanupFailureResolver,
        WebSocketCleanupFailureResolver,
      ],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });

    await app.listen();
    await expect(postGraphql(port, '{ httpCleanup }')).resolves.toEqual({
      data: {
        httpCleanup: 'HttpCleanupFailure',
      },
    });

    const socket = await connectGraphqlWebSocket(port);
    const subscriptionMessages = readGraphqlWebSocketMessages(socket, 2);
    socket.send(JSON.stringify({
      id: 'teardown-errors',
      payload: {
        query: 'subscription { websocketCleanup }',
      },
      type: 'subscribe',
    }));
    await expect(subscriptionMessages).resolves.toEqual([
      {
        id: 'teardown-errors',
        payload: {
          data: {
            websocketCleanup: 'WebSocketCleanupFailure',
          },
        },
        type: 'next',
      },
      {
        id: 'teardown-errors',
        type: 'complete',
      },
    ]);

    const socketClosed = onceWebSocketClosed(socket);
    await expect(app.close()).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof AggregateError)) {
        return false;
      }

      return error.errors.some((item) => item instanceof Error && item.message === 'HTTP operation cleanup failed') &&
        error.errors.some((item) => item instanceof Error && item.message === 'websocket operation cleanup failed');
    });
    await socketClosed;

    cleanupShouldFail = false;
    await expect(app.close()).resolves.toBeUndefined();
  });
});
