import { Inject, Scope } from '@fluojs/core';
import { type Application, defineModule, FluoFactory, type ModuleType } from '@fluojs/runtime';
import { NodeHttpApplicationAdapter } from '@fluojs/runtime/node';
import { MinLength } from '@fluojs/validation';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { describe, expect, it } from 'vitest';

import { Arg, Args, Context, FieldResolver, Parent, Query, Resolver, Subscription } from './decorators.js';
import { GraphqlModule } from './module.js';
import { type GraphQLContext, listOf } from './types.js';

type Product = {
  readonly id: string;
};

const observedRequestIds: number[] = [];
const observedRootRequestIds: number[] = [];

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

@Inject()
@Scope('request')
class RequestState {
  private static nextId = 0;
  readonly id = ++RequestState.nextId;
}

@Inject(RequestState)
@Scope('request')
@Resolver()
class ProductQueryResolver {
  constructor(private readonly requestState: RequestState) {}

  @Query({ outputType: listOf(ProductType) })
  products(): readonly Product[] {
    observedRootRequestIds.push(this.requestState.id);
    return [{ id: 'first' }, { id: 'second' }];
  }

  @Subscription({ outputType: ProductType })
  async *productStream(): AsyncIterable<Product> {
    observedRootRequestIds.push(this.requestState.id);
    yield { id: 'stream' };
  }
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
  @Args(2)
  @Parent(0)
  @Context(1)
  localizedLabel(product: Product, context: GraphQLContext, input: ProductLabelInput): string {
    observedRequestIds.push(this.requestState.id);
    return `${product.id}:${input.locale}:${input.tags.join(',')}:${String(context.region)}`;
  }
}

async function startGraphqlApplication(rootModule: ModuleType): Promise<{ readonly app: Application; readonly origin: string }> {
  const adapter = new NodeHttpApplicationAdapter(0, '127.0.0.1', 0, 0, false, undefined);
  const app = await FluoFactory.create(rootModule, { adapter });
  await app.listen();

  return { app, origin: adapter.getListenTarget().url };
}

async function postGraphql(origin: string, query: string): Promise<unknown> {
  const response = await fetch(`${origin}/graphql`, {
    body: JSON.stringify({ query }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return response.json();
}

async function readSsePayload(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = '';
  const timeout = AbortSignal.timeout(2_000);
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout.addEventListener(
      'abort',
      () => {
        reject(new Error('Timed out waiting for a GraphQL SSE data frame.'));
      },
      { once: true },
    );
  });

  while (buffer.length < 64 * 1024) {
    const chunk = await Promise.race([reader.read(), timedOut]);

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
    observedRootRequestIds.length = 0;

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

    const { app, origin } = await startGraphqlApplication(AppModule);

    try {
      await expect(
        postGraphql(
          origin,
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
      expect(observedRootRequestIds).toEqual([observedRequestIds[0]]);
      const firstOperationRequestId = observedRequestIds[0];

      await expect(postGraphql(origin, '{ products { localizedLabel(locale: "ko", tags: []) } }')).resolves.toEqual({
        data: {
          products: [
            { localizedLabel: 'first:ko::ap-northeast-2' },
            { localizedLabel: 'second:ko::ap-northeast-2' },
          ],
        },
      });

      expect(new Set(observedRequestIds.slice(4))).toHaveLength(1);
      expect(observedRequestIds[4]).not.toBe(firstOperationRequestId);
      expect(observedRootRequestIds[1]).toBe(observedRequestIds[4]);

      const invalidResult = (await postGraphql(origin, '{ products { localizedLabel(locale: "x") } }')) as {
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
    observedRootRequestIds.length = 0;

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

    const { app, origin } = await startGraphqlApplication(AppModule);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await fetch(
        `${origin}/graphql?query=${encodeURIComponent(
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
      expect(observedRootRequestIds).toEqual(observedRequestIds);
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
