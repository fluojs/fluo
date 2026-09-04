import { defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { describe, expect, it } from 'vitest';

import { Arg, Args, FieldResolver, Query, Resolver } from './decorators.js';
import { GraphqlModule } from './module.js';

describe('GraphQL object field resolver DTO input bootstrap guards', () => {
  it('rejects @Args() on root operations during bootstrap', async () => {
    class RootInput {
      @Arg('locale')
      locale = '';
    }

    @Resolver()
    class RootArgsResolver {
      @Query({ input: RootInput })
      @Args()
      localizedLabel(_input: RootInput): string {
        return 'unreachable';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [RootArgsResolver] })],
      providers: [RootArgsResolver],
    });

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port: 0 })).rejects.toThrow(
      /@Parent\(\) and @Context\(\) can only bind parameters on @FieldResolver\(\) methods/,
    );
  });

  it('rejects field resolver input without @Args() during bootstrap', async () => {
    class ProductLabelInput {
      @Arg('locale')
      locale = '';
    }

    @Resolver('FieldResolverInputProduct')
    class MissingArgsResolver {
      @FieldResolver({ input: ProductLabelInput, type: 'string' })
      localizedLabel(): string {
        return 'unreachable';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [MissingArgsResolver] })],
      providers: [MissingArgsResolver],
    });

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port: 0 })).rejects.toThrow(
      /@FieldResolver\(\{ input \}\) requires @Args\(\)/,
    );
  });

  it('rejects @Args() without field resolver input during bootstrap', async () => {
    class ProductLabelInput {
      @Arg('locale')
      locale = '';
    }

    @Resolver('FieldResolverInputProduct')
    class MissingInputResolver {
      @FieldResolver({ type: 'string' })
      @Args()
      localizedLabel(_input: ProductLabelInput): string {
        return 'unreachable';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [MissingInputResolver] })],
      providers: [MissingInputResolver],
    });

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port: 0 })).rejects.toThrow(
      /@Args\(\) requires @FieldResolver\(\{ input \}\)/,
    );
  });
});
