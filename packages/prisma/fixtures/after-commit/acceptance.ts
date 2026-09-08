import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import {
  AfterCommitError as PrismaAfterCommitError,
  PrismaService,
} from '@fluojs/prisma';
import {
  AfterCommitError as DrizzleAfterCommitError,
  DrizzleDatabase,
} from '@fluojs/drizzle';
import {
  AfterCommitError as MongooseAfterCommitError,
  MongooseConnection,
  type MongooseModelFacade,
} from '@fluojs/mongoose';
import { PrismaPg } from '@prisma/adapter-pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import mongoose from 'mongoose';
import { Pool } from 'pg';
import { PrismaClient } from './generated/client/index.js';

const boundary = { requireAfterCommit: true } as const;
const table = pgTable('receipt', { id: text('id').primaryKey() });
const databaseUrl = process.env['DATABASE_URL'];
const mongoUrl = process.env['MONGO_URL'];
assert.ok(databaseUrl, 'Run through node run.mjs to get an isolated PostgreSQL database.');
assert.ok(mongoUrl, 'Run through node run.mjs to get an isolated Mongo replica set.');

const pool = new Pool({ connectionString: databaseUrl });
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const prisma = new PrismaService(client, { strictTransactions: true });
const database = drizzle(pool);
type DrizzleTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type DrizzleOptions = Parameters<typeof database.transaction>[1];
const drizzleService = new DrizzleDatabase<typeof database, DrizzleTransaction, DrizzleOptions>(
  database, undefined, { strictTransactions: true },
);
const connection = mongoose.createConnection(mongoUrl, {
  serverSelectionTimeoutMS: 20_000,
  monitorCommands: true,
});
const Receipt = connection.model('Receipt', new mongoose.Schema({ _id: String }), 'receipt');
const delegated = new MongooseConnection(connection, undefined, { strictTransactions: true });
// Select the public manual-session seam without mutating the native connection.
// Both methods are bound to the real Mongoose connection; there is no fake session.
const manualConnection = {
  startSession: connection.startSession.bind(connection),
  model: connection.model.bind(connection),
};
const manual = new MongooseConnection(manualConnection, undefined, { strictTransactions: true });

type NativeAdapter = {
  readonly name: string;
  readonly transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly requestTransaction: <T>(fn: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
  readonly afterCommit: (callback: () => void | Promise<void>) => void;
  readonly insert: (id: string) => Promise<void>;
  readonly exists: (id: string) => Promise<boolean>;
  readonly context: () => object | undefined;
  readonly assertOutside: () => void;
  readonly failCommit: () => Promise<void>;
  readonly isHookError: (error: unknown) => error is
    PrismaAfterCommitError | DrizzleAfterCommitError | MongooseAfterCommitError;
};

function mongoAdapter(
  name: string,
  wrapper: typeof manual | typeof delegated,
): NativeAdapter {
  return {
    name,
    transaction: (fn) => wrapper.transaction(fn, boundary),
    requestTransaction: (fn, signal) => wrapper.requestTransaction(fn, signal, boundary),
    afterCommit: (callback) => wrapper.afterCommit(callback),
    insert: async (id) => {
      await wrapper.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
    },
    exists: async (id) => (await Receipt.findById(id).lean().exec()) !== null,
    context: () => wrapper.currentSession(),
    assertOutside: () => assert.equal(wrapper.currentSession(), undefined),
    failCommit: async () => {
      // A non-transient server error defeats native commit, not the callback.
      // This failpoint is confined to this run's private mongod.
      await connection.getClient().db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: { failCommands: ['commitTransaction'], errorCode: 2 },
      });
    },
    isHookError: (error): error is MongooseAfterCommitError => error instanceof MongooseAfterCommitError,
  };
}

const adapters: readonly NativeAdapter[] = [
  {
    name: 'Prisma',
    transaction: (fn) => prisma.transaction(fn, undefined, boundary),
    requestTransaction: (fn, signal) => prisma.requestTransaction(fn, signal, undefined, boundary),
    afterCommit: (callback) => prisma.afterCommit(callback),
    insert: async (id) => { await prisma.current().receipt.create({ data: { id } }); },
    exists: async (id) => (await client.receipt.findUnique({ where: { id } })) !== null,
    context: () => prisma.current(),
    assertOutside: () => assert.equal(prisma.current(), client),
    failCommit: async () => {
      await prisma.current().$executeRaw`INSERT INTO deferred_child (id) VALUES ('missing-parent')`;
    },
    isHookError: (error): error is PrismaAfterCommitError => error instanceof PrismaAfterCommitError,
  },
  {
    name: 'Drizzle',
    transaction: (fn) => drizzleService.transaction(fn, undefined, boundary),
    requestTransaction: (fn, signal) => drizzleService.requestTransaction(fn, signal, undefined, boundary),
    afterCommit: (callback) => drizzleService.afterCommit(callback),
    insert: async (id) => { await drizzleService.current().insert(table).values({ id }); },
    exists: async (id) => (await database.select().from(table).where(eq(table.id, id))).length === 1,
    context: () => drizzleService.current(),
    assertOutside: () => assert.equal(drizzleService.current(), database),
    failCommit: async () => {
      await drizzleService.current().execute(sql`INSERT INTO deferred_child (id) VALUES ('missing-parent')`);
    },
    isHookError: (error): error is DrizzleAfterCommitError => error instanceof DrizzleAfterCommitError,
  },
  mongoAdapter('Mongoose manual', manual),
  mongoAdapter('Mongoose delegated', delegated),
];

before(async () => {
  await connection.asPromise();
  await Receipt.createCollection();
  await pool.query(`
    CREATE TABLE receipt (id text PRIMARY KEY);
    CREATE TABLE deferred_parent (id text PRIMARY KEY);
    CREATE TABLE deferred_child (
      id text REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED
    );
  `);
  await prisma.onModuleInit();
});

after(async () => {
  const results = await Promise.allSettled([
    prisma.onApplicationShutdown(),
    drizzleService.onApplicationShutdown(),
    manual.onApplicationShutdown(),
    delegated.onApplicationShutdown(),
  ]);
  const closed = await Promise.allSettled([pool.end(), connection.close()]);
  const errors = [...results, ...closed].flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  assert.deepEqual(errors, [], 'All native clients and wrapper lifecycles must close.');
});

it('loads the public consumer exports from this worktree dist', async () => {
  // Given: local package links, not a source alias or a registry copy.
  for (const name of ['prisma', 'drizzle', 'mongoose']) {
    // When: Node resolves the ordinary public package specifier.
    const actual = await realpath(fileURLToPath(import.meta.resolve(`@fluojs/${name}`)));
    const expected = await realpath(fileURLToPath(new URL(`../../../${name}/dist/index.js`, import.meta.url)));
    // Then: the package export map selects the exact built worktree package.
    assert.equal(actual, expected);
    console.log(`PUBLIC_IMPORT @fluojs/${name} ${actual}`);
  }
});

for (const adapter of adapters) {
  describe(adapter.name, { concurrency: false }, () => {
    it('observes durable commit and nested hook order, then opens a fresh transaction in a hook', async () => {
      // Given: a native root boundary and an ordered hook log.
      const id = `${adapter.name}-commit`;
      const calls: string[] = [];
      // When: outer and nested code register hooks on the shared owner.
      const result = await adapter.transaction(async () => {
        const original = adapter.context();
        assert.ok(original);
        await adapter.insert(id);
        assert.equal(await adapter.exists(id), false, 'Root reads must not see uncommitted data.');
        adapter.afterCommit(async () => {
          adapter.assertOutside();
          assert.equal(await adapter.exists(id), true);
          calls.push('outer');
        });
        await adapter.transaction(async () => {
          assert.equal(adapter.context(), original);
          adapter.afterCommit(async () => {
            adapter.assertOutside();
            await adapter.transaction(async () => {
              assert.notEqual(adapter.context(), original, 'Hook transactions must have a fresh native handle.');
              await adapter.insert(`${id}-fresh`);
              adapter.afterCommit(async () => {
                adapter.assertOutside();
                assert.equal(await adapter.exists(`${id}-fresh`), true);
                calls.push('fresh');
              });
            });
            calls.push('nested');
          });
        });
        assert.deepEqual(calls, [], 'Nested return is not an outer commit.');
        return 42;
      });
      // Then: resolution includes every hook and both durable commits.
      assert.equal(result, 42);
      assert.deepEqual(calls, ['outer', 'fresh', 'nested']);
      assert.equal(await adapter.exists(`${id}-fresh`), true);
      adapter.assertOutside();
    });

    it('discards hooks and native writes when the callback rolls back', async () => {
      // Given: a callback failure with a distinct identity.
      const id = `${adapter.name}-rollback`;
      const failure = new Error('fixture rollback');
      let hookCalls = 0;
      // When: the native transaction rejects.
      await assert.rejects(adapter.transaction(async () => {
        await adapter.insert(id);
        adapter.afterCommit(() => { hookCalls++; });
        throw failure;
      }), (error: unknown) => error === failure);
      // Then: neither commit effects nor hooks survive.
      assert.equal(hookCalls, 0);
      assert.equal(await adapter.exists(id), false);
      adapter.assertOutside();
    });

    it('discards outer and nested hooks when a nested exception escapes', async () => {
      // Given: a nested callback sharing the outer native handle.
      const id = `${adapter.name}-nested-rollback`;
      const failure = new Error('nested rollback');
      let hookCalls = 0;
      // When: the nested failure escapes to the native owner.
      await assert.rejects(adapter.transaction(async () => {
        adapter.afterCommit(() => { hookCalls++; });
        await adapter.transaction(async () => {
          await adapter.insert(id);
          adapter.afterCommit(() => { hookCalls++; });
          throw failure;
        });
      }), (error: unknown) => error === failure);
      // Then: the shared owner rolls back everything.
      assert.equal(hookCalls, 0);
      assert.equal(await adapter.exists(id), false);
    });

    it('retains shared writes and hooks when the owner catches a nested exception and commits', async () => {
      // Given: nested reuse, not a native savepoint.
      const id = `${adapter.name}-caught`;
      const failure = new Error('caught nested failure');
      const calls: string[] = [];
      // When: the outer callback catches the nested application exception.
      await adapter.transaction(async () => {
        adapter.afterCommit(() => { calls.push('outer'); });
        await assert.rejects(adapter.transaction(async () => {
          await adapter.insert(id);
          adapter.afterCommit(async () => {
            adapter.assertOutside();
            assert.equal(await adapter.exists(id), true);
            calls.push('nested');
          });
          throw failure;
        }), (error: unknown) => error === failure);
        assert.deepEqual(calls, []);
      });
      // Then: the successful native owner drains both registrations.
      assert.deepEqual(calls, ['outer', 'nested']);
      assert.equal(await adapter.exists(id), true);
    });

    it('drains request hooks only after a durable native request commit', async () => {
      // Given: the explicit request boundary with required commit support.
      const id = `${adapter.name}-request`;
      let hookCalls = 0;
      // When: an unaborted request completes.
      const result = await adapter.requestTransaction(async () => {
        await adapter.insert(id);
        adapter.afterCommit(async () => {
          adapter.assertOutside();
          assert.equal(await adapter.exists(id), true);
          hookCalls++;
        });
        return 'request-result';
      }, new AbortController().signal);
      // Then: resolution includes the post-commit hook.
      assert.equal(result, 'request-result');
      assert.equal(hookCalls, 1);
    });

    it('rolls back an aborted request using an explicit callback barrier', async () => {
      // Given: signals registered before the transaction starts, with no timers.
      const id = `${adapter.name}-aborted`;
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const controller = new AbortController();
      let hookCalls = 0;
      // When: abort arrives after a native write but before callback completion.
      const pending = adapter.requestTransaction(async () => {
        await adapter.insert(id);
        adapter.afterCommit(() => { hookCalls++; });
        entered.resolve();
        await release.promise;
      }, controller.signal);
      const rejected = assert.rejects(pending);
      await Promise.race([entered.promise, pending]);
      controller.abort(new Error('fixture request abort'));
      release.resolve();
      await rejected;
      // Then: the callback has drained and the native write is rolled back.
      assert.equal(hookCalls, 0);
      assert.equal(await adapter.exists(id), false);
      adapter.assertOutside();
    });

    it('reports package-local all-settled hook errors without undoing the native commit', async () => {
      // Given: a failing hook followed by another real root read.
      const id = `${adapter.name}-hook-failure`;
      const failure = new Error('fixture hook failure');
      const calls: number[] = [];
      // When: hook failure is reported after the native write committed.
      await assert.rejects(adapter.transaction(async () => {
        await adapter.insert(id);
        adapter.afterCommit(() => { calls.push(1); throw failure; });
        adapter.afterCommit(async () => {
          adapter.assertOutside();
          assert.equal(await adapter.exists(id), true);
          calls.push(2);
        });
      }), (error: unknown) => {
        assert.ok(adapter.isHookError(error));
        assert.ok(error instanceof AggregateError);
        assert.equal(error.committed, true);
        assert.deepEqual(error.errors, [failure]);
        assert.deepEqual(error.results, [
          { status: 'rejected', reason: failure },
          { status: 'fulfilled', value: undefined },
        ]);
        return true;
      });
      // Then: all hooks ran and root reads still observe the committed record.
      assert.deepEqual(calls, [1, 2]);
      assert.equal(await adapter.exists(id), true);
    });

    it('discards hooks when the database rejects COMMIT after the callback succeeds', async () => {
      // Given: a native deferred constraint or server-side commit failpoint.
      const id = `${adapter.name}-commit-failure`;
      let callbackFinished = false;
      let hookCalls = 0;
      // When: the callback completes but the database refuses COMMIT.
      await assert.rejects(adapter.transaction(async () => {
        await adapter.insert(id);
        adapter.afterCommit(() => { hookCalls++; });
        await adapter.failCommit();
        callbackFinished = true;
      }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(adapter.isHookError(error), false);
        return true;
      });
      // Then: this was a native commit failure, not a thrown callback.
      assert.equal(callbackFinished, true);
      assert.equal(hookCalls, 0);
      assert.equal(await adapter.exists(id), false);
      adapter.assertOutside();
    });
  });
}

describe('Mongoose delegated native retries', { concurrency: false }, () => {
  it('discards the failed attempt hook when a native write conflict retries the callback', async () => {
    // Given: command events are subscribed before the one-shot native failure.
    const id = 'Mongoose-delegated-transaction-retry';
    const native = connection.getClient();
    let callbacks = 0;
    let inserts = 0;
    let commits = 0;
    const hookAttempts: number[] = [];
    const countCommands = (event: { readonly commandName: string }) => {
      if (event.commandName === 'insert') inserts++;
      if (event.commandName === 'commitTransaction') commits++;
    };
    native.on('commandStarted', countCommands);
    try {
      await native.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: {
          failCommands: ['insert'],
          errorCode: 112,
          errorLabels: ['TransientTransactionError'],
        },
      });
      // When: the driver retries the whole transaction after WriteConflict.
      await delegated.transaction(async () => {
        const attempt = ++callbacks;
        delegated.afterCommit(async () => {
          assert.equal(delegated.currentSession(), undefined);
          assert.ok(await Receipt.findById(id).lean().exec());
          hookAttempts.push(attempt);
        });
        await delegated.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
      }, boundary);
      // Then: two native inserts/callbacks produced one final committed hook.
      assert.equal(callbacks, 2);
      assert.equal(inserts, 2);
      assert.equal(commits, 1);
      assert.deepEqual(hookAttempts, [2]);
      assert.ok(await Receipt.findById(id).lean().exec());
      console.log('NATIVE_RETRY', JSON.stringify({ kind: 'transaction', callbacks, inserts, commits, hookAttempts }));
    } finally {
      native.off('commandStarted', countCommands);
      await native.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  });

  it('runs the callback and hook once when only native COMMIT is retried', async () => {
    // Given: a one-shot unknown commit result, observed through native events.
    const id = 'Mongoose-delegated-commit-retry';
    const native = connection.getClient();
    let callbacks = 0;
    let inserts = 0;
    let commits = 0;
    let hooks = 0;
    const countCommands = (event: { readonly commandName: string }) => {
      if (event.commandName === 'insert') inserts++;
      if (event.commandName === 'commitTransaction') commits++;
    };
    native.on('commandStarted', countCommands);
    try {
      await native.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: {
          failCommands: ['commitTransaction'],
          errorCode: 91,
          errorLabels: ['UnknownTransactionCommitResult'],
        },
      });
      // When: a successful callback is followed by a retried COMMIT command.
      await delegated.transaction(async () => {
        callbacks++;
        delegated.afterCommit(async () => {
          assert.equal(delegated.currentSession(), undefined);
          assert.ok(await Receipt.findById(id).lean().exec());
          hooks++;
        });
        await delegated.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
      }, boundary);
      // Then: the driver retried COMMIT without replaying callback or hook.
      assert.equal(callbacks, 1);
      assert.equal(inserts, 1);
      assert.equal(commits, 2);
      assert.equal(hooks, 1);
      assert.ok(await Receipt.findById(id).lean().exec());
      console.log('NATIVE_RETRY', JSON.stringify({ kind: 'commit', callbacks, inserts, commits, hooks }));
    } finally {
      native.off('commandStarted', countCommands);
      await native.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  });
});
