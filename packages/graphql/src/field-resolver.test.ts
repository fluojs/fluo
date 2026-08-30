import { defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { describe, expect, it } from 'vitest';

import { Context, FieldResolver, Parent, Query, Resolver } from './decorators.js';
import { GraphqlModule } from './module.js';
import { getBoundPort } from './network.test-fixture.js';
import type { GraphQLContext } from './types.js';

type Book = {
  readonly authorId: string;
  readonly id: string;
};

const AuthorType = new GraphQLObjectType({
  fields: {
    id: { type: GraphQLString },
    label: { type: GraphQLString },
  },
  name: 'FieldResolverAuthor',
});

const BookType = new GraphQLObjectType({
  fields: {
    id: { type: GraphQLString },
  },
  name: 'FieldResolverBook',
});

@Resolver()
class BookQueryResolver {
  @Query({ outputType: BookType })
  book(): Book {
    return { authorId: 'author-1', id: 'book-1' };
  }
}

@Resolver('FieldResolverBook')
class BookFieldResolver {
  @FieldResolver({ fieldName: 'author', type: AuthorType })
  @Parent()
  @Context()
  author(parent: Book, context: GraphQLContext): { readonly id: string; readonly label: unknown } {
    return {
      id: parent.authorId,
      label: context.authorLabel,
    };
  }
}

const NullableBookType = new GraphQLObjectType({
  fields: {
    existing: { type: GraphQLString },
    id: { type: GraphQLString },
  },
  name: 'NullableFieldResolverBook',
});

@Resolver()
class NullableBookQueryResolver {
  @Query({ outputType: NullableBookType })
  book(): { readonly id: string } {
    return { id: 'nullable-book-1' };
  }
}

@Resolver('NullableFieldResolverBook')
class NullableBookFieldResolver {
  @FieldResolver({ fieldName: 'defaultValue', type: 'string' })
  defaultValue(): string {
    return 'default';
  }

  @FieldResolver({ fieldName: 'existing', nullable: false })
  existing(): string {
    return 'existing';
  }

  @FieldResolver({ fieldName: 'nullableValue', nullable: true, type: 'string' })
  nullableValue(): string {
    return 'nullable';
  }

  @FieldResolver({ fieldName: 'requiredValue', nullable: false, type: 'string' })
  requiredValue(): string {
    return 'required';
  }
}


async function postGraphql(port: number, query: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/graphql`, {
    body: JSON.stringify({ query }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return response.json();
}

describe('GraphQL object field resolvers', () => {
  it('discovers and executes a field resolver with parent and context bindings', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRoot({
          context: () => ({ authorLabel: 'Ada Lovelace' }),
          resolvers: [BookQueryResolver, BookFieldResolver],
        }),
      ],
      providers: [BookQueryResolver, BookFieldResolver],
    });

    const app = await bootstrapNodeApplication(AppModule, { cors: false, port: 0 });

    try {
      await app.listen();
      const port = await getBoundPort(app);
      await expect(postGraphql(port, '{ book { id author { id label } } }')).resolves.toEqual({
        data: {
          book: {
            author: { id: 'author-1', label: 'Ada Lovelace' },
            id: 'book-1',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('exposes nullable metadata for new typed fields without changing existing fields', async () => {
    // Given
    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ graphiql: true, resolvers: [NullableBookQueryResolver, NullableBookFieldResolver] })],
      providers: [NullableBookQueryResolver, NullableBookFieldResolver],
    });
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port: 0 });

    try {
      await app.listen();
      const port = await getBoundPort(app);

      // When
      await expect(
        postGraphql(
          port,
          '{ __type(name: "NullableFieldResolverBook") { fields { name type { kind name ofType { kind name } } } } }',
        ),
      ).resolves.toMatchObject({
        data: {
          __type: {
            fields: expect.arrayContaining([
              { name: 'defaultValue', type: { kind: 'SCALAR', name: 'String', ofType: null } },
              { name: 'existing', type: { kind: 'SCALAR', name: 'String', ofType: null } },
              { name: 'nullableValue', type: { kind: 'SCALAR', name: 'String', ofType: null } },
              {
                name: 'requiredValue',
                type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'String' } },
              },
            ]),
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('executes new field resolvers across nullable option values', async () => {
    // Given
    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [NullableBookQueryResolver, NullableBookFieldResolver] })],
      providers: [NullableBookQueryResolver, NullableBookFieldResolver],
    });
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port: 0 });

    try {
      await app.listen();
      const port = await getBoundPort(app);

      // When
      const response = postGraphql(port, '{ book { defaultValue existing nullableValue requiredValue } }');

      // Then
      await expect(response).resolves.toEqual({
        data: {
          book: {
            defaultValue: 'default',
            existing: 'existing',
            nullableValue: 'nullable',
            requiredValue: 'required',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects duplicate resolvers for the same object field', async () => {
    @Resolver('FieldResolverBook')
    class DuplicateBookFieldResolver {
      @FieldResolver({ fieldName: 'author', type: AuthorType })
      author(): { readonly id: string; readonly label: string } {
        return { id: 'duplicate', label: 'duplicate' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [BookQueryResolver, BookFieldResolver, DuplicateBookFieldResolver] })],
      providers: [BookQueryResolver, BookFieldResolver, DuplicateBookFieldResolver],
    });

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port: 0 })).rejects.toThrow(
      /FieldResolverBook\.author.*registered more than once/,
    );
  });

  it('rejects parent or context bindings on root operation resolvers', async () => {
    @Resolver()
    class InvalidRootResolver {
      @Query()
      @Parent()
      value(_parent: unknown): string {
        return 'invalid';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [GraphqlModule.forRoot({ resolvers: [InvalidRootResolver] })],
      providers: [InvalidRootResolver],
    });

    await expect(bootstrapNodeApplication(AppModule, { cors: false, port: 0 })).rejects.toThrow(
      /@Parent\(\) and @Context\(\) can only bind parameters on @FieldResolver\(\) methods/,
    );
  });
});
