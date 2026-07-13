import { createServer } from 'node:net';

import { defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { describe, expect, it } from 'vitest';

import { Context, FieldResolver, Parent, Query, Resolver } from './decorators.js';
import { GraphqlModule } from './module.js';
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

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port });

    try {
      await app.listen();
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
