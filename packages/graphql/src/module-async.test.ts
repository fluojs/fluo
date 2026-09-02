import { defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Query, Resolver } from './decorators.js';
import { GraphqlModule } from './module.js';
import { createGraphqlNetworkFixture } from './network.test-fixture.js';

const { bootstrapNodeApplication, findAvailablePort, resolvePort } = createGraphqlNetworkFixture();

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

async function connectGraphqlWebSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(await resolvePort(port))}/graphql`, 'graphql-transport-ws');

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  socket.send(JSON.stringify({ type: 'connection_init' }));

  const acknowledgment = await new Promise<unknown>((resolve, reject) => {
    socket.once('message', resolve);
    socket.once('error', reject);
  });

  expect(toWebSocketText(acknowledgment)).toBe(
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
    socket.close();
    await new Promise<void>((resolve) => socket.once('close', resolve));

    expect(factoryCalls).toEqual(['configured']);
    await app.close();
  });

  it('cleans up a rejected factory registration so the application graph can retry', async () => {
    @Resolver('RetryAsyncOptionsResolver')
    class RetryAsyncOptionsResolver {
      @Query()
      status(): string {
        return 'ready after retry';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRootAsync({
          useFactory: async () => {
            throw new Error('async GraphQL configuration failed');
          },
        }),
      ],
      providers: [RetryAsyncOptionsResolver],
    });

    const port = await findAvailablePort();

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port })).rejects.toThrow(
      'async GraphQL configuration failed',
    );

    class RecoveryModule {}
    defineModule(RecoveryModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [RetryAsyncOptionsResolver] })],
      providers: [RetryAsyncOptionsResolver],
    });

    const app = await bootstrapNodeApplication(RecoveryModule, { cors: false, port });
    await app.listen();

    await expect(postGraphql(port, '{ status }')).resolves.toEqual({
      data: { status: 'ready after retry' },
    });

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
