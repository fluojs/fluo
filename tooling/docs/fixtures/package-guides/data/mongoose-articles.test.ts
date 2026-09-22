import { CacheService } from '@fluojs/cache-manager';
import { MongooseConnection } from '@fluojs/mongoose';
import { FluoFactory } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import {
  type ArticleRecord,
  createArticlesApp,
  createArticlesCacheApp,
  type FixtureConnection,
  type FixtureDocument,
  type FixtureSession,
} from './mongoose-articles.example';

/**
 * Guide fixtures for the Mongoose package guide
 * (apps/docs/content/docs/packages/mongoose.mdx).
 *
 * Evidence scope: the connection here is a driver double driven through the
 * wrapper's documented seams (startSession / delegated transaction / model
 * factory). These tests prove @fluojs/mongoose's own contracts - session
 * injection, conflicts, saveDocument, drain ordering, fail-open, and the
 * after-commit/cache flow. They do NOT prove MongoDB server transaction
 * atomicity (see packages/mongoose/src/after-commit.test.ts and the shared
 * native fixture).
 */

interface ModelCall {
  op: string;
  args: unknown[];
}

function createFakeConnection(): {
  connection: FixtureConnection;
  events: string[];
  modelCalls: ModelCall[];
  session: FixtureSession;
} {
  const events: string[] = [];
  const modelCalls: ModelCall[] = [];
  const session: FixtureSession = {
    startTransaction: async () => {
      events.push('start');
    },
    commitTransaction: async () => {
      events.push('commit');
    },
    abortTransaction: async () => {
      events.push('abort');
    },
    endSession: async () => {
      events.push('end');
    },
  };
  const articleModel = {
    create: async (...args: unknown[]): Promise<readonly ArticleRecord[]> => {
      modelCalls.push({ op: 'create', args });
      const docs = args[0] as readonly { title: string }[];
      return docs.map((doc, index) => ({ _id: `a${index + 1}`, title: doc.title }));
    },
    findOne: async (...args: unknown[]): Promise<ArticleRecord | null> => {
      modelCalls.push({ op: 'findOne', args });
      return { _id: 'a1', title: 'first' };
    },
  };
  const connection: FixtureConnection = {
    startSession: async () => {
      events.push('new-session');
      return session;
    },
    model: (name: string) => {
      if (name !== 'Article') {
        throw new Error(`Unexpected model ${name}`);
      }
      return articleModel;
    },
  };
  return { connection, events, modelCalls, session };
}

function createDelegatedConnection(): {
  connection: FixtureConnection;
  events: string[];
  modelCalls: ModelCall[];
  session: FixtureSession;
} {
  const events: string[] = [];
  const modelCalls: ModelCall[] = [];
  const session: FixtureSession = {
    startTransaction: async () => {
      events.push('start');
    },
    commitTransaction: async () => {
      events.push('commit');
    },
    abortTransaction: async () => {
      events.push('abort');
    },
    endSession: async () => {
      events.push('end');
    },
  };
  const articleModel = {
    create: async (...args: unknown[]): Promise<readonly ArticleRecord[]> => {
      modelCalls.push({ op: 'create', args });
      const docs = args[0] as readonly { title: string }[];
      return docs.map((doc, index) => ({ _id: `a${index + 1}`, title: doc.title }));
    },
    findOne: async (...args: unknown[]): Promise<ArticleRecord | null> => {
      modelCalls.push({ op: 'findOne', args });
      return { _id: 'a1', title: 'first' };
    },
  };
  const connection: FixtureConnection = {
    model: (name: string) => {
      if (name !== 'Article') {
        throw new Error(`Unexpected model ${name}`);
      }
      return articleModel;
    },
    async transaction<T>(fn: (session: FixtureSession) => Promise<T>): Promise<T> {
      events.push('delegated-open');
      const result = await fn(session);
      events.push('delegated-commit');
      return result;
    },
  };
  return { connection, events, modelCalls, session };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sessionOf(call: ModelCall): unknown {
  const options = call.args.at(-1) as { session?: unknown } | undefined;
  return options?.session;
}

describe('mongoose guide fixtures: session transactions', () => {
  it('injects the ambient session into supported facade operations inside @Transaction', async () => {
    const { connection, events, modelCalls, session } = createFakeConnection();
    const { ArticlesModule, ArticlesService, ArticlesRepository } = createArticlesApp(connection);
    const module = await Test.createTestingModule({ rootModule: ArticlesModule }).compile();

    try {
      const service = await module.resolve(ArticlesService);
      const repo = await module.resolve(ArticlesRepository);

      const article = await service.publish('hello');
      expect(article).toEqual({ _id: 'a1', title: 'hello' });

      // Both facade calls received the ambient session; the wrapper drove the session.
      expect(modelCalls.map((call) => call.op)).toEqual(['create', 'findOne']);
      expect(sessionOf(modelCalls[0]!)).toBe(session);
      expect(sessionOf(modelCalls[1]!)).toBe(session);
      expect(events).toEqual(['new-session', 'start', 'commit', 'end']);
      expect(events.indexOf('commit')).toBeLessThan(events.indexOf('end'));

      // Outside the boundary: no ambient session, root connection unchanged.
      expect(repo.currentSession()).toBeUndefined();
      expect(repo.currentConnection()).toBe(connection);
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects an explicit session conflict inside an ambient transaction', async () => {
    const { connection } = createFakeConnection();
    const { ArticlesModule, ArticlesService } = createArticlesApp(connection);
    const module = await Test.createTestingModule({ rootModule: ArticlesModule }).compile();

    try {
      const service = await module.resolve(ArticlesService);

      await expect(service.createWithConflictingSession('conflict')).rejects.toThrow(
        'Explicit session: null conflicts with ambient transaction session',
      );
    } finally {
      await module.container.dispose();
    }
  });

  it('saves an existing document through the opt-in helper inside a boundary only', async () => {
    const { connection, modelCalls, session } = createFakeConnection();
    const { ArticlesModule, ArticlesRepository, ArticlesService } = createArticlesApp(connection);
    const module = await Test.createTestingModule({ rootModule: ArticlesModule }).compile();

    try {
      const service = await module.resolve(ArticlesService);
      const saves: Array<unknown> = [];
      const document: FixtureDocument = {
        save: async (options) => {
          saves.push(options);
          return document;
        },
      };

      const saved = await service.saveWithinBoundary(document);

      expect(saved).toBe(document);
      expect(saves).toEqual([{ session }]);
      expect(modelCalls.every((call) => call.op !== 'save')).toBe(true);

      // Outside a boundary the helper fails closed instead of silently detaching.
      const repo = await module.resolve(ArticlesRepository);
      await expect(repo.save(document)).rejects.toThrow(
        'Mongoose document saves require an active transaction session.',
      );
    } finally {
      await module.container.dispose();
    }
  });

  it('uses the delegated connection.transaction path when the connection provides it', async () => {
    const { connection, events, modelCalls, session } = createDelegatedConnection();
    const { ArticlesModule, ArticlesService } = createArticlesApp(connection);
    const module = await Test.createTestingModule({ rootModule: ArticlesModule }).compile();

    try {
      const service = await module.resolve(ArticlesService);

      const article = await service.publish('delegated');
      expect(article).toEqual({ _id: 'a1', title: 'delegated' });

      // The wrapper delegated to connection.transaction and injected the
      // delegated session into the facade operations.
      expect(events).toEqual(['delegated-open', 'delegated-commit']);
      expect(sessionOf(modelCalls[0]!)).toBe(session);
    } finally {
      await module.container.dispose();
    }
  });

  it('fails open without session support when strictTransactions is false', async () => {
    const bareConnection: FixtureConnection = {
      model: (name: string) => {
        if (name !== 'Article') {
          throw new Error(`Unexpected model ${name}`);
        }
        return {
          create: async (...args: unknown[]): Promise<readonly ArticleRecord[]> => {
            const docs = args[0] as readonly { title: string }[];
            return docs.map((doc, index) => ({ _id: `a${index + 1}`, title: doc.title }));
          },
          findOne: async (): Promise<ArticleRecord | null> => null,
        };
      },
    };
    const { ArticlesModule, ArticlesService } = createArticlesApp(bareConnection);
    const module = await Test.createTestingModule({ rootModule: ArticlesModule }).compile();

    try {
      const service = await module.resolve(ArticlesService);
      const article = await service.publishWithoutBoundary('direct');

      expect(article).toEqual([{ _id: 'a1', title: 'direct' }]);
    } finally {
      await module.container.dispose();
    }
  });
});

describe('mongoose guide fixtures: shutdown drain', () => {
  it('aborts an open request transaction on shutdown and disposes only after session cleanup', async () => {
    const { connection, events } = createFakeConnection();
    const disposeEvents: string[] = [];
    const { ArticlesModule } = createArticlesApp(connection, { onDispose: () => disposeEvents.push('dispose') });
    const context = await FluoFactory.createApplicationContext(ArticlesModule);
    const conn = await context.get(MongooseConnection);

    const entered = deferred();
    const release = deferred();
    const boundary = conn.requestTransaction(async () => {
      entered.resolve();
      await release.promise;
      return 'ok';
    }, undefined);

    await entered.promise;
    const closing = context.close();
    release.resolve();

    await expect(boundary).rejects.toThrow('Application shutdown interrupted an open request transaction.');
    await closing;

    expect(events).toEqual(['new-session', 'start', 'abort', 'end']);
    expect(disposeEvents).toEqual(['dispose']);
  });
});

describe('mongoose guide fixtures: after-commit cache composition', () => {
  it('drains the afterCommit hook after commit and session cleanup, invalidating the cache entry', async () => {
    const { connection, events } = createFakeConnection();
    const { ArticlesCacheModule, ArticlesCacheService } = createArticlesCacheApp(connection, events);
    const context = await FluoFactory.createApplicationContext(ArticlesCacheModule);

    try {
      const articlesCache = await context.get(ArticlesCacheService);
      const cache = await context.get(CacheService);
      await cache.set('articles:list', ['old']);

      await articlesCache.createAndInvalidate('hello');

      expect(events).toEqual(['new-session', 'start', 'commit', 'end', 'after-commit-hook']);
      await expect(cache.get('articles:list')).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
