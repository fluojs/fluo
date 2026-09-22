import { CacheModule, CacheService } from '@fluojs/cache-manager';
import { type Constructor, Inject, Module } from '@fluojs/core';
import { MongooseConnection, type MongooseModelFacade, MongooseModule, Transaction } from '@fluojs/mongoose';

/**
 * Complete canonical articles application from the Mongoose package guide
 * (apps/docs/content/docs/packages/mongoose.mdx), parameterized over the
 * connection so the guide's fixtures can supply a connection double. The
 * wrapper's session lifecycle, facade session injection, drain ordering, and
 * capability contracts belong to @fluojs/mongoose; native MongoDB transaction
 * atomicity is verified by the package-owned native fixture
 * (packages/prisma/fixtures/after-commit/ shared Mongo acceptance).
 */

export interface ArticleRecord {
  readonly _id: string;
  readonly title: string;
}

export type ArticleCreateModel = MongooseModelFacade<Promise<readonly ArticleRecord[]>>;
export type ArticleFindOneModel = MongooseModelFacade<unknown, unknown, Promise<ArticleRecord | null>>;

export interface FixtureSession {
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  endSession(): Promise<void>;
}

/** Connection seam: MongooseConnectionLike plus the model factory the wrapper resolves dynamically. */
export interface FixtureConnection {
  startSession?(): Promise<FixtureSession>;
  transaction?<T>(fn: (session: FixtureSession) => Promise<T>): Promise<T>;
  model(name: string): unknown;
}

export interface FixtureDocument {
  save(options?: { session?: unknown }): Promise<FixtureDocument>;
}

export interface ArticlesAppHooks {
  onDispose?: () => void;
  strictTransactions?: boolean;
}

export function createArticlesApp(connection: FixtureConnection, hooks?: ArticlesAppHooks): {
  ArticlesModule: Constructor;
  ArticlesRepository: Constructor<{
    conn: MongooseConnection;
    create(title: string): Promise<readonly ArticleRecord[]>;
    findFirst(title: string): Promise<ArticleRecord | null>;
    createWithConflictingSession(title: string): Promise<readonly ArticleRecord[]>;
    currentSession(): ReturnType<MongooseConnection['currentSession']>;
    currentConnection(): ReturnType<MongooseConnection['current']>;
    save(document: FixtureDocument): Promise<FixtureDocument>;
  }>;
  ArticlesService: Constructor<{
    publish(title: string): Promise<ArticleRecord | undefined>;
    publishWithoutBoundary(title: string): Promise<readonly ArticleRecord[]>;
    saveWithinBoundary(document: FixtureDocument): Promise<FixtureDocument>;
    createWithConflictingSession(title: string): Promise<readonly ArticleRecord[]>;
  }>;
} {
  @Inject(MongooseConnection)
  class ArticlesRepository {
    constructor(readonly conn: MongooseConnection) {}

    create(title: string) {
      // Array-overload create receives the ambient session inside @Transaction.
      return this.conn.model<ArticleCreateModel>('Article').create([{ title }]);
    }

    findFirst(title: string) {
      return this.conn.model<ArticleFindOneModel>('Article').findOne({ title });
    }

    createWithConflictingSession(title: string) {
      return this.conn.model<ArticleCreateModel>('Article').create([{ title }], { session: null });
    }

    currentSession() {
      return this.conn.currentSession();
    }

    currentConnection() {
      return this.conn.current();
    }

    save(document: FixtureDocument) {
      return this.conn.saveDocument(document);
    }
  }

  @Inject(ArticlesRepository)
  class ArticlesService {
    constructor(private readonly repo: InstanceType<typeof ArticlesRepository>) {}

    /** Service transaction boundary: the canonical explicit-target decorator form. */
    @Transaction((self) => self.repo.conn)
    async publish(title: string) {
      const [article] = await this.repo.create(title);
      await this.repo.findFirst(title);
      return article;
    }

    publishWithoutBoundary(title: string) {
      return this.repo.create(title);
    }

    /** Opt-in helper for saving an existing document inside the ambient session. */
    @Transaction((self) => self.repo.conn)
    saveWithinBoundary(document: FixtureDocument) {
      return this.repo.save(document);
    }

    /** Conflict detection only applies inside an ambient transaction. */
    @Transaction((self) => self.repo.conn)
    createWithConflictingSession(title: string) {
      return this.repo.createWithConflictingSession(title);
    }
  }

  @Module({
    imports: [
      MongooseModule.forRoot({
        connection,
        strictTransactions: hooks?.strictTransactions,
        dispose: async () => {
          hooks?.onDispose?.();
        },
      }),
    ],
    providers: [ArticlesRepository, ArticlesService],
  })
  class ArticlesModule {}

  return { ArticlesModule, ArticlesRepository, ArticlesService };
}

export function createArticlesCacheApp(connection: FixtureConnection, events: string[]): {
  ArticlesCacheModule: Constructor;
  ArticlesCacheService: Constructor<{ createAndInvalidate(title: string): Promise<void> }>;
} {
  @Inject(MongooseConnection, CacheService)
  class ArticlesCacheService {
    constructor(
      private readonly conn: MongooseConnection,
      private readonly cache: CacheService,
    ) {}

    /** After-commit cache invalidation: the hook runs only after native commit. */
    createAndInvalidate(title: string) {
      return this.conn.transaction(async () => {
        await this.conn.model<ArticleCreateModel>('Article').create([{ title }]);
        this.conn.afterCommit(async () => {
          events.push('after-commit-hook');
          await this.cache.del('articles:list');
        });
      }, { requireAfterCommit: true });
    }
  }

  @Module({
    imports: [
      MongooseModule.forRoot({ connection }),
      CacheModule.forRoot({ store: 'memory' }),
    ],
    providers: [ArticlesCacheService],
  })
  class ArticlesCacheModule {}

  return { ArticlesCacheModule, ArticlesCacheService };
}
