import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapNodeApplication, defineModule } from '@konekti/runtime';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';

import { Arg, Mutation, Query, Resolver, Subscription } from './decorators.js';
import { createGraphqlModule } from './module.js';

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
  value = '';
}

@Inject([ResolverState])
@Resolver('RootResolver')
class GraphqlResolver {
  constructor(private readonly state: ResolverState) {}

  @Query({ input: EchoInput })
  echo(input: EchoInput): string {
    return input.value;
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
});
