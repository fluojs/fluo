import { createServer } from 'node:net';

import { Inject, Scope } from '@fluojs/core';
import { defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { MinLength } from '@fluojs/validation';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { describe, expect, it } from 'vitest';

import { Arg, Args, Context, FieldResolver, Parent, Query, Resolver, Subscription } from './decorators.js';
import { GraphqlModule } from './module.js';
import { listOf, type GraphQLContext } from './types.js';

type Product = {
  readonly id: string;
};

const observedRequestIds: number[] = [];

class ProductLabelInput {
  @Arg('locale')
  @MinLength(2)
  locale = '';

  @Arg('tags')
  tags: string[] = [];
}

const ProductType = new GraphQLObjectType({
  fields: {
    id: { type: GraphQLString },
    localizedLabel: { type: GraphQLString },
  },
  name: 'FieldResolverInputProduct',
});

@Resolver()
class ProductQueryResolver {
  @Query({ outputType: listOf(ProductType) })
  products(): readonly Product[] {
    return [{ id: 'first' }, { id: 'second' }];
  }

  @Subscription({ outputType: ProductType })
  async *productStream(): AsyncIterable<Product> {
    yield { id: 'stream' };
  }
}

@Inject()
@Scope('request')
class RequestState {
  private static nextId = 0;
  readonly id = ++RequestState.nextId;
}

@Inject(RequestState)
@Scope('request')
@Resolver('FieldResolverInputProduct')
class ProductFieldResolver {
  constructor(private readonly requestState: RequestState) {}

  @FieldResolver({
    argTypes: { tags: listOf('string') },
    fieldName: 'localizedLabel',
    input: ProductLabelInput,
    type: 'string',
  })
  @Args(0)
  @Parent(1)
  @Context(2)
  localizedLabel(input: ProductLabelInput, product: Product, context: GraphQLContext): string {
    observedRequestIds.push(this.requestState.id);
    return `${product.id}:${input.locale}:${input.tags.join(',')}:${String(context.region)}`;
  }
}

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
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return response.json();
}

async function readSsePayload(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (buffer.length < 64 * 1024) {
    const chunk = await reader.read();

    if (chunk.done) {
      throw new Error('Expected a GraphQL SSE data frame before the response stream closed.');
    }

    buffer += decoder.decode(chunk.value, { stream: true });
    const dataLine = buffer.split(/\r?\n/).find((line) => line.startsWith('data: '));

    if (dataLine) {
      return JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
    }
  }

  throw new Error('Expected buffered GraphQL SSE frames to fit within 64 KiB.');
}

describe('GraphQL object field resolver DTO inputs', () => {
  it('materializes scalar and list HTTP arguments at explicit field resolver indexes', async () => {
    observedRequestIds.length = 0;

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRoot({
          context: () => ({ region: 'ap-northeast-2' }),
          resolvers: [ProductQueryResolver, ProductFieldResolver],
        }),
      ],
      providers: [RequestState, ProductQueryResolver, ProductFieldResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });

    try {
      await app.listen();

      await expect(
        postGraphql(
          port,
          '{ products { ko: localizedLabel(locale: "ko", tags: ["new", "sale"]) en: localizedLabel(locale: "en", tags: ["featured"]) } }',
        ),
      ).resolves.toEqual({
        data: {
          products: [
            {
              en: 'first:en:featured:ap-northeast-2',
              ko: 'first:ko:new,sale:ap-northeast-2',
            },
            {
              en: 'second:en:featured:ap-northeast-2',
              ko: 'second:ko:new,sale:ap-northeast-2',
            },
          ],
        },
      });

      expect(new Set(observedRequestIds)).toHaveLength(1);
      const firstOperationRequestId = observedRequestIds[0];

      await expect(postGraphql(port, '{ products { localizedLabel(locale: "ko", tags: []) } }')).resolves.toEqual({
        data: {
          products: [
            { localizedLabel: 'first:ko::ap-northeast-2' },
            { localizedLabel: 'second:ko::ap-northeast-2' },
          ],
        },
      });

      expect(new Set(observedRequestIds.slice(4))).toHaveLength(1);
      expect(observedRequestIds[4]).not.toBe(firstOperationRequestId);

      const invalidResult = (await postGraphql(port, '{ products { localizedLabel(locale: "x") } }')) as {
        data: { products: Array<{ localizedLabel: unknown }> };
        errors: Array<{ extensions?: { code?: string; issues?: Array<{ field?: string }> }; message: string }>;
      };

      expect(invalidResult.errors[0]?.message).toBe('Validation failed.');
      expect(invalidResult.errors[0]?.extensions?.code).toBe('BAD_USER_INPUT');
      expect(invalidResult.errors[0]?.extensions?.issues?.[0]?.field).toBe('locale');
      expect(invalidResult.data.products).toEqual([{ localizedLabel: null }, { localizedLabel: null }]);
    } finally {
      await app.close();
    }
  });

  it('materializes field arguments for subscription payload execution', async () => {
    observedRequestIds.length = 0;

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRoot({
          context: () => ({ region: 'ap-northeast-2' }),
          resolvers: [ProductQueryResolver, ProductFieldResolver],
        }),
      ],
      providers: [RequestState, ProductQueryResolver, ProductFieldResolver],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      await app.listen();
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/graphql?query=${encodeURIComponent(
          'subscription { productStream { localizedLabel(locale: "ko", tags: ["live"]) } }',
        )}`,
        {
          headers: { accept: 'text/event-stream' },
          method: 'GET',
        },
      );

      expect(response.status).toBe(200);
      reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Expected GraphQL subscription response body.');
      }

      await expect(readSsePayload(reader)).resolves.toEqual({
        data: {
          productStream: {
            localizedLabel: 'stream:ko:live:ap-northeast-2',
          },
        },
      });
      expect(observedRequestIds).toHaveLength(1);
    } finally {
      await reader?.cancel();
      await app.close();
    }
  });

  it('rejects colliding field resolver parameter indexes', () => {
    expect(() => {
      @Resolver('FieldResolverInputProduct')
      class CollidingFieldResolver {
        @FieldResolver({ input: ProductLabelInput, type: 'string' })
        @Args(0)
        @Parent(0)
        localizedLabel(_input: ProductLabelInput, _product: Product): string {
          return 'unreachable';
        }
      }

      return CollidingFieldResolver;
    }).toThrow(/parameter 0.*already bound/);
  });
});
