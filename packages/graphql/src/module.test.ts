import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Inject, Scope } from '@konekti/core';
import { IsInt, MinLength } from '@konekti/dto-validator';
import { bootstrapNodeApplication, defineModule } from '@konekti/runtime';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';

import { Arg, Mutation, Query, Resolver, Subscription } from './decorators.js';
import { createGraphqlModule } from './module.js';
import { GRAPHQL_OPERATION_CONTAINER } from './types.js';

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

async function postGraphql(port: number, query: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/graphql`, {
    body: JSON.stringify({ query }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  return response.json();
}

function decodeChunk(value: Uint8Array): string {
  return Buffer.from(value).toString('utf8');
}

type GraphqlWebSocketMessage = {
  id?: string;
  payload?: {
    data?: Record<string, unknown>;
  };
  type: string;
};

function onceWebSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function onceWebSocketClosed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
  });
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
    socket.once('message', handleMessage);
    socket.once('error', reject);
  });
}

async function connectGraphqlWebSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/graphql`, 'graphql-transport-ws');

  await onceWebSocketOpen(socket);
  socket.send(JSON.stringify({ type: 'connection_init' }));

  await expect(onceGraphqlWebSocketMessage(socket)).resolves.toEqual({
    type: 'connection_ack',
  });

  return socket;
}

async function readGraphqlWebSocketMessages(socket: WebSocket, count: number): Promise<GraphqlWebSocketMessage[]> {
  return await new Promise<GraphqlWebSocketMessage[]>((resolve, reject) => {
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

      if (messages.length >= count) {
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

@Inject([])
class ResolverState {
  mutableValue = 'init';
}

class EchoInput {
  @Arg('value')
  @MinLength(3)
  value = '';
}

class IncrementInput {
  @Arg('count')
  @IsInt()
  count = 0;
}

@Inject([ResolverState])
@Resolver('RootResolver')
class GraphqlResolver {
  constructor(private readonly state: ResolverState) {}

  @Query({ input: EchoInput })
  echo(input: EchoInput): string {
    return input.value;
  }

  @Query({ input: IncrementInput, outputType: 'int' })
  increment(input: IncrementInput): number {
    return input.count + 1;
  }

  @Mutation({ input: EchoInput })
  setValue(input: EchoInput): string {
    this.state.mutableValue = input.value;
    return this.state.mutableValue;
  }

  @Query('value')
  value(): string {
    return this.state.mutableValue;
  }

  @Subscription()
  async *pingStream(): AsyncGenerator<string, void, void> {
    yield 'ping';
  }
}

describe('@konekti/graphql', () => {
  it('handles query and mutation through /graphql middleware', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          resolvers: [GraphqlResolver],
        }),
      ],
      providers: [ResolverState, GraphqlResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    await expect(postGraphql(port, '{ echo(value: "hello") }')).resolves.toEqual({
      data: {
        echo: 'hello',
      },
    });

    await expect(postGraphql(port, '{ increment(count: 2) }')).resolves.toEqual({
      data: {
        increment: 3,
      },
    });

    await expect(postGraphql(port, 'mutation { setValue(value: "world") }')).resolves.toEqual({
      data: {
        setValue: 'world',
      },
    });

    await expect(postGraphql(port, '{ value }')).resolves.toEqual({
      data: {
        value: 'world',
      },
    });

    const invalidResult = (await postGraphql(port, '{ echo(value: "hi") }')) as {
      data: Record<string, unknown>;
      errors: Array<{ extensions?: { code?: string; issues?: Array<{ field?: string }> }; message: string }>;
    };

    expect(invalidResult.errors[0]?.message).toBe('Validation failed.');
    expect(invalidResult.errors[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(invalidResult.errors[0]?.extensions?.issues?.[0]?.field).toBe('value');
    expect(invalidResult.data.echo).toBeNull();

    const missingArgResult = (await postGraphql(port, '{ echo }')) as {
      data: Record<string, unknown>;
      errors: Array<{ extensions?: { code?: string; issues?: Array<{ field?: string }> }; message: string }>;
    };

    expect(missingArgResult.errors[0]?.message).toBe('Validation failed.');
    expect(missingArgResult.errors[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(missingArgResult.data.echo).toBeNull();

    await app.close();
  });

  it('streams subscriptions over SSE by default', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          resolvers: [GraphqlResolver],
        }),
      ],
      providers: [ResolverState, GraphqlResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/graphql?query=${encodeURIComponent('subscription { pingStream }')}`,
      {
        headers: {
          accept: 'text/event-stream',
        },
        method: 'GET',
        signal: controller.signal,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Expected SSE response body reader.');
    }

    const firstChunk = await reader.read();
    controller.abort();

    expect(firstChunk.done).toBe(false);
    expect(decodeChunk(firstChunk.value!)).toContain('pingStream');

    await app.close();
  });

  it('streams subscriptions over graphql-ws when websocket transport is enabled', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          resolvers: [GraphqlResolver],
          subscriptions: {
            websocket: {
              enabled: true,
            },
          },
        }),
      ],
      providers: [ResolverState, GraphqlResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const socket = await connectGraphqlWebSocket(port);
    socket.send(JSON.stringify({
      id: 'sub-1',
      payload: {
        query: 'subscription { pingStream }',
      },
      type: 'subscribe',
    }));

    await expect(readGraphqlWebSocketMessages(socket, 2)).resolves.toEqual([
      {
        id: 'sub-1',
        payload: {
          data: {
            pingStream: 'ping',
          },
        },
        type: 'next',
      },
      {
        id: 'sub-1',
        type: 'complete',
      },
    ]);

    socket.close();
    await onceWebSocketClosed(socket);
    await app.close();
  });

  it('supports schema-first mode with raw GraphQLSchema', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        fields: {
          hello: {
            resolve: () => 'schema-first',
            type: GraphQLString,
          },
        },
        name: 'Query',
      }),
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          schema,
        }),
      ],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    await expect(postGraphql(port, '{ hello }')).resolves.toEqual({
      data: {
        hello: 'schema-first',
      },
    });

    await app.close();
  });

  it('boots the same GraphQL module repeatedly without leaking middleware registration across app instances', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          resolvers: [GraphqlResolver],
        }),
      ],
      providers: [ResolverState, GraphqlResolver],
    });

    const firstPort = await findAvailablePort();
    const firstApp = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port: firstPort,
    });

    await firstApp.listen();
    await expect(postGraphql(firstPort, '{ echo(value: "first") }')).resolves.toEqual({
      data: {
        echo: 'first',
      },
    });
    await firstApp.close();

    const secondPort = await findAvailablePort();
    const secondApp = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port: secondPort,
    });

    await secondApp.listen();
    await expect(postGraphql(secondPort, '{ echo(value: "second") }')).resolves.toEqual({
      data: {
        echo: 'second',
      },
    });
    await secondApp.close();
  });

  it('keeps internal operation container when custom context includes reserved symbol key', async () => {
    const poisonedOperationContainer = {
      async dispose() {},
      async resolve() {
        throw new Error('poisoned operation container should not be used');
      },
    };

    @Inject([])
    @Resolver('ReservedContextResolver')
    class ReservedContextResolver {
      @Query()
      ping(): string {
        return 'pong';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          context: () => ({
            [GRAPHQL_OPERATION_CONTAINER]: poisonedOperationContainer,
          }),
          resolvers: [ReservedContextResolver],
        }),
      ],
      providers: [ReservedContextResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    await expect(postGraphql(port, '{ ping }')).resolves.toEqual({
      data: {
        ping: 'pong',
      },
    });

    await app.close();
  });
});

describe('@konekti/graphql — provider scopes', () => {
  it('isolates request-scoped resolver instances across concurrent operations', async () => {
    let issued = 0;

    @Inject([])
    @Scope('request')
    class RequestIdentity {
      readonly id = `req-${String(++issued)}`;
    }

    @Inject([RequestIdentity])
    @Scope('request')
    @Resolver('ConcurrentRequestResolver')
    class ConcurrentRequestResolver {
      constructor(private readonly identity: RequestIdentity) {}

      @Query()
      async requestId(): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return this.identity.id;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule({ resolvers: [ConcurrentRequestResolver] })],
      providers: [RequestIdentity, ConcurrentRequestResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const [op1, op2] = await Promise.all([
      postGraphql(port, '{ requestId }'),
      postGraphql(port, '{ requestId }'),
    ]);

    const id1 = (op1 as { data?: { requestId?: string } }).data?.requestId;
    const id2 = (op2 as { data?: { requestId?: string } }).data?.requestId;

    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
    expect(id1).not.toBe(id2);

    await app.close();
  });

  it('request-scoped resolver receives a fresh instance per operation', async () => {
    @Inject([])
    @Scope('request')
    class RequestCounter {
      count = 0;
    }

    @Inject([RequestCounter])
    @Scope('request')
    @Resolver('ScopedResolver')
    class RequestScopedResolver {
      constructor(private readonly counter: RequestCounter) {}

      @Query({ outputType: 'int' })
      tick(): number {
        this.counter.count += 1;
        return this.counter.count;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule({ resolvers: [RequestScopedResolver] })],
      providers: [RequestCounter, RequestScopedResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const r1 = await postGraphql(port, '{ tick }');
    const r2 = await postGraphql(port, '{ tick }');

    expect(r1).toEqual({ data: { tick: 1 } });
    expect(r2).toEqual({ data: { tick: 1 } });

    await app.close();
  });

  it('reuses one request scope across all resolver fields in the same operation', async () => {
    @Inject([])
    @Scope('request')
    class OperationCounter {
      count = 0;
    }

    @Inject([OperationCounter])
    @Scope('request')
    @Resolver('OperationScopedResolver')
    class OperationScopedResolver {
      constructor(private readonly counter: OperationCounter) {}

      @Query({ outputType: 'int' })
      firstTick(): number {
        this.counter.count += 1;
        return this.counter.count;
      }

      @Query({ outputType: 'int' })
      secondTick(): number {
        this.counter.count += 1;
        return this.counter.count;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule({ resolvers: [OperationScopedResolver] })],
      providers: [OperationCounter, OperationScopedResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const firstOperation = await postGraphql(port, '{ firstTick secondTick }');
    const secondOperation = await postGraphql(port, '{ firstTick secondTick }');

    expect(firstOperation).toEqual({ data: { firstTick: 1, secondTick: 2 } });
    expect(secondOperation).toEqual({ data: { firstTick: 1, secondTick: 2 } });

    await app.close();
  });

  it('isolates request-scoped subscription resolvers per websocket operation', async () => {
    let issued = 0;

    @Inject([])
    @Scope('request')
    class SubscriptionRequestIdentity {
      readonly id = `subscription-${String(++issued)}`;
    }

    @Inject([SubscriptionRequestIdentity])
    @Scope('request')
    @Resolver('ScopedSubscriptionResolver')
    class ScopedSubscriptionResolver {
      constructor(private readonly identity: SubscriptionRequestIdentity) {}

      @Subscription()
      async *requestIds(): AsyncGenerator<string, void, void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield this.identity.id;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createGraphqlModule({
          resolvers: [ScopedSubscriptionResolver],
          subscriptions: {
            websocket: {
              enabled: true,
            },
          },
        }),
      ],
      providers: [SubscriptionRequestIdentity, ScopedSubscriptionResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const firstSocket = await connectGraphqlWebSocket(port);
    const secondSocket = await connectGraphqlWebSocket(port);

    firstSocket.send(JSON.stringify({
      id: 'sub-a',
      payload: {
        query: 'subscription { requestIds }',
      },
      type: 'subscribe',
    }));
    secondSocket.send(JSON.stringify({
      id: 'sub-b',
      payload: {
        query: 'subscription { requestIds }',
      },
      type: 'subscribe',
    }));

    const [firstMessages, secondMessages] = await Promise.all([
      readGraphqlWebSocketMessages(firstSocket, 2),
      readGraphqlWebSocketMessages(secondSocket, 2),
    ]);
    const firstId = firstMessages.find((message) => message.type === 'next')?.payload?.data?.requestIds;
    const secondId = secondMessages.find((message) => message.type === 'next')?.payload?.data?.requestIds;

    expect(firstId).toMatch(/^subscription-/);
    expect(secondId).toMatch(/^subscription-/);
    expect(firstId).not.toBe(secondId);

    firstSocket.close();
    secondSocket.close();
    await Promise.all([onceWebSocketClosed(firstSocket), onceWebSocketClosed(secondSocket)]);
    await app.close();
  });

  it('transient resolver receives a fresh instance per operation', async () => {
    @Inject([])
    @Scope('transient')
    class TransientCounter {
      count = 0;
    }

    @Inject([TransientCounter])
    @Scope('transient')
    @Resolver('TransientResolver')
    class TransientScopedResolver {
      constructor(private readonly counter: TransientCounter) {}

      @Query({ outputType: 'int' })
      transientTick(): number {
        this.counter.count += 1;
        return this.counter.count;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule({ resolvers: [TransientScopedResolver] })],
      providers: [TransientCounter, TransientScopedResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const r1 = await postGraphql(port, '{ transientTick }');
    const r2 = await postGraphql(port, '{ transientTick }');

    expect(r1).toEqual({ data: { transientTick: 1 } });
    expect(r2).toEqual({ data: { transientTick: 1 } });

    await app.close();
  });

  it('singleton resolver shares state across operations', async () => {
    @Inject([])
    class SingletonCounter {
      count = 0;
    }

    @Inject([SingletonCounter])
    @Resolver('SingletonResolver')
    class SingletonScopedResolver {
      constructor(private readonly counter: SingletonCounter) {}

      @Query({ outputType: 'int' })
      singletonTick(): number {
        this.counter.count += 1;
        return this.counter.count;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule({ resolvers: [SingletonScopedResolver] })],
      providers: [SingletonCounter, SingletonScopedResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const r1 = await postGraphql(port, '{ singletonTick }');
    const r2 = await postGraphql(port, '{ singletonTick }');

    expect(r1).toEqual({ data: { singletonTick: 1 } });
    expect(r2).toEqual({ data: { singletonTick: 2 } });

    await app.close();
  });

  it('discovers resolvers from useValue providers via instance constructor', async () => {
    @Resolver('UseValueResolver')
    class UseValueResolver {
      constructor(private readonly greeting: string) {}

      @Query()
      useValueHello(): string {
        return this.greeting;
      }
    }

    const resolverInstance = new UseValueResolver('Hello from useValue!');

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule()],
      providers: [{ provide: UseValueResolver, useValue: resolverInstance }],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    await expect(postGraphql(port, '{ useValueHello }')).resolves.toEqual({
      data: { useValueHello: 'Hello from useValue!' },
    });

    await app.close();
  });

  it('discovers resolvers from useFactory providers with resolverClass', async () => {
    @Resolver('UseFactoryResolver')
    class UseFactoryResolver {
      constructor(private readonly config: { prefix: string }) {}

      @Query()
      useFactoryGreeting(): string {
        return `${this.config.prefix} World`;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule()],
      providers: [
        {
          provide: UseFactoryResolver,
          useFactory: () => new UseFactoryResolver({ prefix: 'Hello' }),
          resolverClass: UseFactoryResolver,
        },
      ],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    await expect(postGraphql(port, '{ useFactoryGreeting }')).resolves.toEqual({
      data: { useFactoryGreeting: 'Hello World' },
    });

    await app.close();
  });

  it('inherits request scope from useFactory resolverClass metadata', async () => {
    @Inject([])
    @Scope('request')
    class FactoryRequestCounter {
      count = 0;
    }

    @Inject([FactoryRequestCounter])
    @Scope('request')
    @Resolver('FactoryRequestScopedResolver')
    class FactoryRequestScopedResolver {
      constructor(private readonly counter: FactoryRequestCounter) {}

      @Query({ outputType: 'int' })
      factoryRequestTick(): number {
        this.counter.count += 1;
        return this.counter.count;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule()],
      providers: [
        FactoryRequestCounter,
        {
          provide: FactoryRequestScopedResolver,
          inject: [FactoryRequestCounter],
          useFactory: (...deps) => {
            const [counter] = deps;

            if (!(counter instanceof FactoryRequestCounter)) {
              throw new Error('FactoryRequestScopedResolver requires FactoryRequestCounter.');
            }

            return new FactoryRequestScopedResolver(counter);
          },
          resolverClass: FactoryRequestScopedResolver,
        },
      ],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    const r1 = await postGraphql(port, '{ factoryRequestTick }');
    const r2 = await postGraphql(port, '{ factoryRequestTick }');

    expect(r1).toEqual({ data: { factoryRequestTick: 1 } });
    expect(r2).toEqual({ data: { factoryRequestTick: 1 } });

    await app.close();
  });

  it('handles mixed provider registrations (class, useValue, useFactory) in same module', async () => {
    @Resolver('ClassResolver')
    class ClassResolver {
      @Query()
      classHello(): string {
        return 'from class';
      }
    }

    @Resolver('ValueResolver')
    class ValueResolver {
      @Query()
      valueHello(): string {
        return 'from value';
      }
    }

    @Resolver('FactoryResolver')
    class FactoryResolver {
      @Query()
      factoryHello(): string {
        return 'from factory';
      }
    }

    const valueInstance = new ValueResolver();

    class AppModule {}
    defineModule(AppModule, {
      imports: [createGraphqlModule()],
      providers: [
        ClassResolver,
        { provide: ValueResolver, useValue: valueInstance },
        {
          provide: FactoryResolver,
          useFactory: () => new FactoryResolver(),
          resolverClass: FactoryResolver,
        },
      ],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    await app.listen();

    await expect(postGraphql(port, '{ classHello }')).resolves.toEqual({
      data: { classHello: 'from class' },
    });

    await expect(postGraphql(port, '{ valueHello }')).resolves.toEqual({
      data: { valueHello: 'from value' },
    });

    await expect(postGraphql(port, '{ factoryHello }')).resolves.toEqual({
      data: { factoryHello: 'from factory' },
    });

    await app.close();
  });
});
