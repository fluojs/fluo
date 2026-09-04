import { EventEmitter, on } from 'node:events';

import { Inject, Module } from '@fluojs/core';
import {
  Arg,
  Context,
  createDataLoader,
  FieldResolver,
  GraphqlModule,
  Mutation,
  Parent,
  Query,
  Resolver,
  Subscription,
  type GraphQLContext,
  listOf,
} from '@fluojs/graphql';
import { GraphQLObjectType, GraphQLString } from 'graphql';

type Author = {
  readonly id: string;
  readonly name: string;
};

type Book = {
  readonly authorId: string;
  readonly title: string;
};

const authors = new Map<string, Author>([
  ['ada', { id: 'ada', name: 'Ada' }],
  ['grace', { id: 'grace', name: 'Grace' }],
]);

const books: readonly Book[] = [
  { authorId: 'ada', title: 'Composable Systems' },
  { authorId: 'grace', title: 'Operation Boundaries' },
  { authorId: 'ada', title: 'DataLoader Patterns' },
];

const AuthorType = new GraphQLObjectType({
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
  name: 'Author',
});

const BookType = new GraphQLObjectType({
  fields: {
    author: { type: AuthorType },
    title: { type: GraphQLString },
  },
  name: 'Book',
});

const authorById = createDataLoader<string, Author | null>(async (ids) =>
  ids.map((id) => authors.get(id) ?? null),
);

@Inject()
export class LiveUpdates {
  private readonly events = new EventEmitter();
  private readonly subscriberReady: Promise<void>;
  private resolveSubscriber: (() => void) | undefined;

  constructor() {
    this.subscriberReady = new Promise<void>((resolve) => {
      this.resolveSubscriber = resolve;
    });
  }

  publish(title: string): string {
    this.events.emit('book-published', title);
    return title;
  }

  async *subscribe(): AsyncGenerator<string, void, void> {
    this.resolveSubscriber?.();

    for await (const [title] of on(this.events, 'book-published')) {
      if (typeof title !== 'string') {
        throw new Error('Expected a published book title.');
      }

      yield title;
    }
  }

  async waitForSubscriber(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for the GraphQL subscription subscriber.'));
      }, 1_000);
    });

    try {
      await Promise.race([this.subscriberReady, timedOut]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

class PublishBookInput {
  @Arg('title')
  title = '';
}

@Resolver()
class CatalogResolver {
  @Query({ outputType: listOf(BookType) })
  books(): readonly Book[] {
    return books;
  }
}

@Resolver('Book')
class BookResolver {
  @FieldResolver('author')
  @Parent()
  @Context()
  async author(book: Book, context: GraphQLContext): Promise<Author | null> {
    return await authorById(context).load(book.authorId);
  }
}

@Inject(LiveUpdates)
@Resolver()
class PublicationResolver {
  constructor(private readonly updates: LiveUpdates) {}

  @Mutation({ input: PublishBookInput })
  publishBook(input: PublishBookInput): string {
    return this.updates.publish(input.title);
  }

  @Subscription()
  bookPublished(): AsyncGenerator<string, void, void> {
    return this.updates.subscribe();
  }
}

@Module({
  imports: [
    GraphqlModule.forRoot({
      resolvers: [CatalogResolver, BookResolver, PublicationResolver],
    }),
  ],
  providers: [LiveUpdates, CatalogResolver, BookResolver, PublicationResolver],
})
export class AppModule {}
