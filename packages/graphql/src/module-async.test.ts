import { defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Query, Resolver } from './decorators.js';
import { GraphqlModule } from './module.js';
import { createGraphqlNetworkFixture } from './network.test-fixture.js';

const { bootstrapNodeApplication, findAvailablePort, resolvePort } = createGraphqlNetworkFixture();
const WEBSOCKET_EVENT_TIMEOUT_MS = 1_000;

async function postGraphql(port: number, query: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${String(await resolvePort(port))}/graphql`, {
    body: JSON.stringify({ query }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  return await response.json();
}

function toWebSocketText(message: unknown): string {
  return Buffer.isBuffer(message) ? message.toString('utf8') : String(message);
}

function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for the GraphQL websocket to open.'));
    }, WEBSOCKET_EVENT_TIMEOUT_MS);
    const onOpen = (): void => {
      finish(resolve);
    };
    const onError = (error: Error): void => {
      finish(reject, error);
    };

    function finish(settle: (value?: never) => void, error?: Error): void {
      clearTimeout(timeout);
      socket.off('error', onError);
      socket.off('open', onOpen);

      if (error === undefined) {
        settle();
      } else {
        reject(error);
      }
    }

    socket.once('error', onError);
    socket.once('open', onOpen);
  });
}

function waitForWebSocketMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for the GraphQL websocket acknowledgement.'));
    }, WEBSOCKET_EVENT_TIMEOUT_MS);
    const onMessage = (message: unknown): void => {
      finish(resolve, message);
    };
    const onError = (error: Error): void => {
      finish(reject, error);
    };

    function finish(settle: (value: unknown) => void, value: unknown): void {
      clearTimeout(timeout);
      socket.off('error', onError);
      socket.off('message', onMessage);
      settle(value);
    }

    socket.once('error', onError);
    socket.once('message', onMessage);
  });
}

function waitForWebSocketClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for the GraphQL websocket to close.'));
    }, WEBSOCKET_EVENT_TIMEOUT_MS);
    const onClose = (): void => {
      finish(resolve);
    };
    const onError = (error: Error): void => {
      finish(reject, error);
    };

    function finish(settle: (value?: never) => void, error?: Error): void {
      clearTimeout(timeout);
      socket.off('close', onClose);
      socket.off('error', onError);

      if (error === undefined) {
        settle();
      } else {
        reject(error);
      }
    }

    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

async function connectGraphqlWebSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(await resolvePort(port))}/graphql`, 'graphql-transport-ws');

  await waitForWebSocketOpen(socket);
  const acknowledgment = waitForWebSocketMessage(socket);
  socket.send(JSON.stringify({ type: 'connection_init' }));

  expect(toWebSocketText(await acknowledgment)).toBe(
    JSON.stringify({ type: 'connection_ack' }),
  );

  return socket;
}

describe('GraphqlModule.forRootAsync', () => {
  it('resolves injected options once and wires HTTP and websocket endpoints', async () => {
    const GRAPHQL_SETTINGS = Symbol('graphql-settings');
    const factoryCalls: string[] = [];

    @Resolver('AsyncOptionsResolver')
    class AsyncOptionsResolver {
      @Query()
      greeting(): string {
        return 'configured asynchronously';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRootAsync({
          inject: [GRAPHQL_SETTINGS],
          useFactory: async (...dependencies: unknown[]) => {
            const [settings] = dependencies;

            if (settings !== 'configured') {
              throw new Error('GraphQL async settings token must resolve before registration.');
            }

            factoryCalls.push(settings);
            return {
              resolvers: [AsyncOptionsResolver],
              subscriptions: {
                websocket: { enabled: true },
              },
            };
          },
        }),
      ],
      providers: [
        AsyncOptionsResolver,
        { provide: GRAPHQL_SETTINGS, useValue: 'configured' },
      ],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    await expect(postGraphql(port, '{ greeting }')).resolves.toEqual({
      data: { greeting: 'configured asynchronously' },
    });
    await expect(postGraphql(port, '{ greeting }')).resolves.toEqual({
      data: { greeting: 'configured asynchronously' },
    });

    const socket = await connectGraphqlWebSocket(port);
    const closed = waitForWebSocketClose(socket);
    socket.close();
    await closed;

    expect(factoryCalls).toEqual(['configured']);
    await app.close();
  });

  it('cleans up a rejected factory registration so the application graph can retry', async () => {
    let factoryCalls = 0;

    @Resolver('RetryAsyncOptionsResolver')
    class RetryAsyncOptionsResolver {
      @Query()
      status(): string {
        return 'ready after retry';
      }
    }

    const asyncRegistration = GraphqlModule.forRootAsync({
      useFactory: async () => {
        factoryCalls += 1;

        if (factoryCalls === 1) {
            throw new Error('async GraphQL configuration failed');
        }

        return { resolvers: [RetryAsyncOptionsResolver] };
      },
    });
    class AppModule {}
    defineModule(AppModule, {
      imports: [asyncRegistration],
      providers: [RetryAsyncOptionsResolver],
    });

    const port = await findAvailablePort();

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port })).rejects.toThrow(
      'async GraphQL configuration failed',
    );

    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    await expect(postGraphql(port, '{ status }')).resolves.toEqual({
      data: { status: 'ready after retry' },
    });

    expect(factoryCalls).toBeGreaterThan(1);
    await app.close();
  });

  it('rejects unsupported NestJS-style registration shapes', () => {
    const unsupportedShapes = [
      { imports: [] },
      { useClass: class ConfigurationFactory {} },
      { useExisting: Symbol('configuration-factory') },
    ];

    for (const unsupportedShape of unsupportedShapes) {
      const options = {
        ...unsupportedShape,
        useFactory: () => ({}),
      };

      expect(() => GraphqlModule.forRootAsync(options)).toThrow(
        'GraphqlModule.forRootAsync does not support',
      );
    }
  });
});
