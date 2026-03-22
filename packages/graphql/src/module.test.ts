import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
    const app = await bootstrapNodeApplication(AppModule, { cors: false, mode: 'test', port });
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
    const app = await bootstrapNodeApplication(AppModule, { cors: false, mode: 'test', port });
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
    const app = await bootstrapNodeApplication(AppModule, { cors: false, mode: 'test', port });
    await app.listen();

    const firstOperation = await postGraphql(port, '{ firstTick secondTick }');
    const secondOperation = await postGraphql(port, '{ firstTick secondTick }');

    expect(firstOperation).toEqual({ data: { firstTick: 1, secondTick: 2 } });
    expect(secondOperation).toEqual({ data: { firstTick: 1, secondTick: 2 } });

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
    const app = await bootstrapNodeApplication(AppModule, { cors: false, mode: 'test', port });
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
    const app = await bootstrapNodeApplication(AppModule, { cors: false, mode: 'test', port });
    await app.listen();

    const r1 = await postGraphql(port, '{ singletonTick }');
    const r2 = await postGraphql(port, '{ singletonTick }');

    expect(r1).toEqual({ data: { singletonTick: 1 } });
    expect(r2).toEqual({ data: { singletonTick: 2 } });

    await app.close();
  });
});
