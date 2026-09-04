import { EventEmitter, on } from 'node:events';

import { Inject, Module } from '@fluojs/core';
import type { OnApplicationShutdown } from '@fluojs/runtime';
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
export class LiveUpdates implements OnApplicationShutdown {
  private static readonly publishedEvent = 'book-published';
  private readonly closeSubscriptions = new Set<() => void>();
  private readonly events = new EventEmitter();
  private readonly subscriberReady: Promise<void>;
  private resolveSubscriber: (() => void) | undefined;

  constructor() {
    this.subscriberReady = new Promise<void>((resolve) => {
      this.resolveSubscriber = resolve;
    });
  }

  publish(title: string): string {
    this.events.emit(LiveUpdates.publishedEvent, title);
    return title;
  }

  subscribe(): AsyncIterableIterator<string, void, void> {
    const controller = new AbortController();
    const source = on(this.events, LiveUpdates.publishedEvent, {
      signal: controller.signal,
    });
    const close = () => {
      if (!this.closeSubscriptions.delete(close)) {
        return;
      }

      controller.abort();
    };
    this.closeSubscriptions.add(close);
    this.resolveSubscriber?.();

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: async () => {
        try {
          const result = await source.next();

          if (result.done) {
            close();
            return { done: true, value: undefined };
          }

          const [title] = result.value;

          if (typeof title !== 'string') {
            close();
            throw new Error('Expected a published book title.');
          }

          return { done: false, value: title };
        } catch (error) {
          if (controller.signal.aborted && error instanceof Error && error.name === 'AbortError') {
            return { done: true, value: undefined };
          }

          close();
          throw error;
        }
      },
      return: async () => {
        close();
        return { done: true, value: undefined };
      },
    };
  }

  onApplicationShutdown(): void {
    for (const close of [...this.closeSubscriptions]) {
      close();
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

  getSubscriberListenerCount(): number {
    return this.events.listenerCount(LiveUpdates.publishedEvent);
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
  bookPublished(): AsyncIterableIterator<string, void, void> {
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
