import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import {
  AfterCommitError as PrismaAfterCommitError,
  createPrismaRollbackObserver,
  PrismaService,
  Transaction as PrismaTransaction,
  TransactionRollbackCapabilityError as PrismaRollbackCapabilityError,
  TransactionRollbackOnlyError as PrismaRollbackOnlyError,
  type TransactionBoundaryOptions as PrismaBoundaryOptions,
} from '@fluojs/prisma';
import {
  AfterCommitError as DrizzleAfterCommitError,
  createDrizzleRollbackObserver,
  DrizzleDatabase,
  Transaction as DrizzleTransactionDecorator,
  TransactionRollbackCapabilityError as DrizzleRollbackCapabilityError,
  TransactionRollbackOnlyError as DrizzleRollbackOnlyError,
  type TransactionBoundaryOptions as DrizzleBoundaryOptions,
} from '@fluojs/drizzle';
import {
  AfterCommitError as MongooseAfterCommitError,
  createMongooseRollbackObserver,
  MongooseConnection,
  Transaction as MongooseTransaction,
  TransactionRollbackCapabilityError as MongooseRollbackCapabilityError,
  TransactionRollbackOnlyError as MongooseRollbackOnlyError,
  TransactionRollbackUnconfirmedError as MongooseUnconfirmedError,
  type MongooseModelFacade,
  type TransactionBoundaryOptions as MongooseBoundaryOptions,
} from '@fluojs/mongoose';
import { PrismaPg } from '@prisma/adapter-pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import mongoose from 'mongoose';
import { Client, Pool } from 'pg';
import { PrismaClient } from './generated/client/index.js';

const boundary = { requireAfterCommit: true } as const;
const table = pgTable('receipt', { id: text('id').primaryKey() });
const databaseUrl = process.env['DATABASE_URL'];
const mongoUrl = process.env['MONGO_URL'];
assert.ok(databaseUrl, 'Run through node run.mjs to get an isolated PostgreSQL database.');
assert.ok(mongoUrl, 'Run through node run.mjs to get an isolated Mongo replica set.');

const pool = new Pool({ connectionString: databaseUrl });
const prismaObservation = createPrismaRollbackObserver(new PrismaPg({ connectionString: databaseUrl }));
const client = new PrismaClient({ adapter: prismaObservation.adapter });
const prisma = new PrismaService(client, { strictTransactions: true, rollbackObserver: prismaObservation.rollbackObserver });
const drizzleObservation = createDrizzleRollbackObserver(pool);
const database = drizzle(drizzleObservation.client);
type DrizzleTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type DrizzleOptions = Parameters<typeof database.transaction>[1];
const drizzleService = new DrizzleDatabase<typeof database, DrizzleTransaction, DrizzleOptions>(
  database, undefined, { strictTransactions: true, rollbackObserver: drizzleObservation.rollbackObserver },
);
const connection = mongoose.createConnection(mongoUrl, {
  serverSelectionTimeoutMS: 20_000,
  monitorCommands: true,
});
const Receipt = connection.model('Receipt', new mongoose.Schema({ _id: String }), 'receipt');
const mongooseObservation = createMongooseRollbackObserver(connection.getClient());
const delegated = new MongooseConnection(connection, undefined, { strictTransactions: true, rollbackObserver: mongooseObservation });
// Select the public manual-session seam without mutating the native connection.
// All methods are bound to the real Mongoose connection; there is no fake session.
const manualConnection = {
  getClient: connection.getClient.bind(connection),
  startSession: connection.startSession.bind(connection),
  model: connection.model.bind(connection),
};
const manual = new MongooseConnection(manualConnection, undefined, { strictTransactions: true, rollbackObserver: mongooseObservation });

type FixtureBoundary<T> =
  PrismaBoundaryOptions<T> & DrizzleBoundaryOptions<T> & MongooseBoundaryOptions<T>;
type Outcome = { readonly accepted: boolean; readonly detail: string };
const resultBoundary = {
  requireAfterCommit: true,
  shouldRollback: (value: Outcome) => !value.accepted,
} satisfies FixtureBoundary<Outcome>;

type MethodHost<T> = { readonly run: (this: MethodHost<T>) => Promise<T> };

function invokeDecorated<T>(
  fn: () => Promise<T>,
  decorator: (
    value: MethodHost<T>['run'],
    context: ClassMethodDecoratorContext<MethodHost<T>, MethodHost<T>['run']>,
  ) => MethodHost<T>['run'],
): Promise<T> {
  const host: MethodHost<T> = {
    async run() {
      assert.equal(this, host, 'The real decorator must preserve the method receiver.');
      return fn();
    },
  };
  // Node strips types but not decorator syntax. Invoke the actual public TC39
  // factory with its typed context, not an imitation transaction wrapper.
  const context: ClassMethodDecoratorContext<MethodHost<T>, MethodHost<T>['run']> = {
    kind: 'method',
    name: 'run',
    static: false,
    private: false,
    access: {
      has: (value) => 'run' in value,
      get: (value) => value.run,
    },
    addInitializer: (initializer) => initializer.call(host),
    metadata: undefined,
  };
  return decorator(host.run, context).call(host);
}

type NativeAdapter = {
  readonly name: string;
  readonly transaction: <T>(fn: () => Promise<T>, options?: FixtureBoundary<T>) => Promise<T>;
  readonly requestTransaction: <T>(
    fn: () => Promise<T>, signal?: AbortSignal, options?: FixtureBoundary<T>,
  ) => Promise<T>;
  readonly decoratedTransaction: <T>(fn: () => Promise<T>, options?: FixtureBoundary<T>) => Promise<T>;
  readonly afterCommit: (callback: () => void | Promise<void>) => void;
  readonly insert: (id: string) => Promise<void>;
  readonly exists: (id: string) => Promise<boolean>;
  readonly context: () => object | undefined;
  readonly assertOutside: () => void;
  readonly failCommit: () => Promise<void>;
  readonly isHookError: (error: unknown) => error is
    PrismaAfterCommitError | DrizzleAfterCommitError | MongooseAfterCommitError;
  readonly isRollbackOnlyError: (error: unknown) => error is
    PrismaRollbackOnlyError | DrizzleRollbackOnlyError | MongooseRollbackOnlyError;
};

function mongoAdapter(
  name: string,
  wrapper: typeof manual | typeof delegated,
): NativeAdapter {
  return {
    name,
    transaction: (fn, options = boundary) => wrapper.transaction(fn, options),
    requestTransaction: (fn, signal, options = boundary) => wrapper.requestTransaction(fn, signal, options),
    decoratedTransaction: <T>(fn: () => Promise<T>, options: FixtureBoundary<T> = boundary) =>
      invokeDecorated(fn, MongooseTransaction((_self: MethodHost<T>) => wrapper, options)),
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
    isRollbackOnlyError: (error): error is MongooseRollbackOnlyError => error instanceof MongooseRollbackOnlyError,
  };
}

const adapters: readonly NativeAdapter[] = [
  {
    name: 'Prisma',
    transaction: (fn, options = boundary) => prisma.transaction(fn, undefined, options),
    requestTransaction: (fn, signal, options = boundary) => prisma.requestTransaction(fn, signal, undefined, options),
    decoratedTransaction: <T>(fn: () => Promise<T>, options: FixtureBoundary<T> = boundary) =>
      invokeDecorated(fn, PrismaTransaction((_self: MethodHost<T>) => prisma, options)),
    afterCommit: (callback) => prisma.afterCommit(callback),
    insert: async (id) => { await prisma.current().receipt.create({ data: { id } }); },
    exists: async (id) => (await client.receipt.findUnique({ where: { id } })) !== null,
    context: () => prisma.current(),
    assertOutside: () => assert.equal(prisma.current(), client),
    failCommit: async () => {
      await prisma.current().$executeRaw`INSERT INTO deferred_child (id) VALUES ('missing-parent')`;
    },
    isHookError: (error): error is PrismaAfterCommitError => error instanceof PrismaAfterCommitError,
    isRollbackOnlyError: (error): error is PrismaRollbackOnlyError => error instanceof PrismaRollbackOnlyError,
  },
  {
    name: 'Drizzle',
    transaction: (fn, options = boundary) => drizzleService.transaction(fn, undefined, options),
    requestTransaction: (fn, signal, options = boundary) => drizzleService.requestTransaction(fn, signal, undefined, options),
    decoratedTransaction: <T>(fn: () => Promise<T>, options: FixtureBoundary<T> = boundary) =>
      invokeDecorated(fn, DrizzleTransactionDecorator((_self: MethodHost<T>) => drizzleService, undefined, options)),
    afterCommit: (callback) => drizzleService.afterCommit(callback),
    insert: async (id) => { await drizzleService.current().insert(table).values({ id }); },
    exists: async (id) => (await database.select().from(table).where(eq(table.id, id))).length === 1,
    context: () => drizzleService.current(),
    assertOutside: () => assert.equal(drizzleService.current(), database),
    failCommit: async () => {
      await drizzleService.current().execute(sql`INSERT INTO deferred_child (id) VALUES ('missing-parent')`);
    },
    isHookError: (error): error is DrizzleAfterCommitError => error instanceof DrizzleAfterCommitError,
    isRollbackOnlyError: (error): error is DrizzleRollbackOnlyError => error instanceof DrizzleRollbackOnlyError,
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
  for (const ErrorType of [
    PrismaRollbackCapabilityError, DrizzleRollbackCapabilityError, MongooseRollbackCapabilityError,
    PrismaRollbackOnlyError, DrizzleRollbackOnlyError, MongooseRollbackOnlyError,
  ]) {
    assert.ok(ErrorType.prototype instanceof Error, 'Result errors must be public runtime exports.');
  }
});

for (const mode of ['manual', 'delegated'] as const) {
  for (const entry of ['transaction', 'requestTransaction'] as const) {
    for (const accepted of [true, false]) {
      it(`Mongoose ${mode} ${entry} rejects a foreign observer before accepted=${accepted} work`, async () => {
        const foreignConnection = mongoose.createConnection(mongoUrl, {
          serverSelectionTimeoutMS: 20_000,
          monitorCommands: true,
        });
        const native = mode === 'manual'
          ? {
            getClient: foreignConnection.getClient.bind(foreignConnection),
            startSession: foreignConnection.startSession.bind(foreignConnection),
          }
          : foreignConnection;
        const wrapper = new MongooseConnection(native, undefined, {
          strictTransactions: true, rollbackObserver: mongooseObservation,
        });
        try {
          await foreignConnection.asPromise();
          assert.notEqual(foreignConnection.getClient(), connection.getClient());
          let callbacks = 0;
          let predicates = 0;
          const value: Outcome = { accepted, detail: 'foreign-client-admission' };
          const callback = async () => { callbacks++; return value; };
          const policy = {
            shouldRollback(result: Outcome) { predicates++; return !result.accepted; },
          };
          const pending = entry === 'transaction'
            ? wrapper.transaction(callback, policy)
            : wrapper.requestTransaction(callback, undefined, policy);
          const outcome = await pending.then(
            (result) => ({ result, error: undefined }),
            (error: unknown) => ({ result: undefined, error }),
          );
          assert.equal(callbacks, 0);
          assert.equal(predicates, 0);
          assert.ok(outcome.error instanceof MongooseRollbackCapabilityError);
          assert.equal(outcome.result, undefined);
          assert.equal(wrapper.currentSession(), undefined);
        } finally {
          try {
            await wrapper.onApplicationShutdown();
          } finally {
            await foreignConnection.close();
          }
        }
      });
    }
  }
}

for (const adapter of adapters) {
  const surfaces: readonly {
    readonly name: string;
    readonly run: NativeAdapter['transaction'];
  }[] = [
    { name: 'transaction', run: adapter.transaction },
    {
      name: 'requestTransaction',
      run: (fn, options) => adapter.requestTransaction(fn, new AbortController().signal, options),
    },
    { name: 'Transaction decorator', run: adapter.decoratedTransaction },
  ];
  for (const surface of surfaces) {
    describe(`${adapter.name} Result ${surface.name}`, { concurrency: false }, () => {
      for (const accepted of [true, false]) {
        it(`returns the same root value after native ${accepted ? 'commit' : 'rollback'}`, async () => {
          // Given: an application-specific shape, with no framework Result convention.
          const id = `${adapter.name}-${surface.name}-root-${accepted}`;
          const value: Outcome = { accepted, detail: id };
          let predicates = 0;
          let hooks = 0;
          // When: the separate Fluo boundary evaluates the completed callback.
          const result = await surface.run(async () => {
            await adapter.insert(id);
            assert.equal(await adapter.exists(id), false);
            adapter.afterCommit(async () => {
              adapter.assertOutside();
              assert.equal(await adapter.exists(id), true);
              hooks++;
            });
            return value;
          }, {
            requireAfterCommit: true,
            shouldRollback: (observed) => {
              assert.equal(observed, value);
              predicates++;
              return !observed.accepted;
            },
          });
          // Then: callback identity survives and native completion controls hooks/data.
          assert.equal(result, value);
          assert.equal(predicates, 1);
          assert.equal(hooks, accepted ? 1 : 0);
          assert.equal(await adapter.exists(id), accepted);
          adapter.assertOutside();
        });
      }

      for (const [innerAccepted, outerAccepted] of [
        [true, true], [true, false], [false, true], [false, false],
      ] as const) {
        it(`settles nested=${innerAccepted} root=${outerAccepted} on one native owner`, async () => {
          // Given: nested and root callbacks return distinct application-owned values.
          const id = `${adapter.name}-${surface.name}-nested-${innerAccepted}-${outerAccepted}`;
          const inner: Outcome = { accepted: innerAccepted, detail: `${id}-inner` };
          const outer: Outcome = { accepted: outerAccepted, detail: `${id}-outer` };
          const hooks: string[] = [];
          let innerPredicates = 0;
          let outerPredicates = 0;
          // When: both opted-in boundaries evaluate their own value.
          const pending = surface.run(async () => {
            const owner = adapter.context();
            await adapter.insert(outer.detail);
            adapter.afterCommit(() => { hooks.push('outer'); });
            const nested = await surface.run(async () => {
              assert.equal(adapter.context(), owner);
              await adapter.insert(inner.detail);
              adapter.afterCommit(() => { hooks.push('inner'); });
              return inner;
            }, {
              ...resultBoundary,
              shouldRollback: (value) => {
                assert.equal(value, inner);
                innerPredicates++;
                return !value.accepted;
              },
            });
            assert.equal(nested, inner, 'Nested failure returns without ending the shared owner.');
            assert.deepEqual(hooks, []);
            await adapter.insert(`${id}-after-inner`);
            return outer;
          }, {
            ...resultBoundary,
            shouldRollback: (value) => {
              assert.equal(value, outer);
              outerPredicates++;
              return !value.accepted;
            },
          });
          // Then: root failure wins; otherwise an ignored nested failure is reported.
          if (!innerAccepted && outerAccepted) {
            await assert.rejects(pending, (error: unknown) => {
              assert.ok(adapter.isRollbackOnlyError(error));
              assert.equal(error.result, inner);
              return true;
            });
          } else {
            assert.equal(await pending, outer);
          }
          const committed = innerAccepted && outerAccepted;
          assert.equal(innerPredicates, 1);
          assert.equal(outerPredicates, 1);
          assert.deepEqual(hooks, committed ? ['outer', 'inner'] : []);
          for (const key of [outer.detail, inner.detail, `${id}-after-inner`]) {
            assert.equal(await adapter.exists(key), committed);
          }
          adapter.assertOutside();
        });
      }

      it('keeps the first ignored inner failure sticky without a root predicate', async () => {
        // Given: no root opt-in; the first and second failures have distinct identities.
        const id = `${adapter.name}-${surface.name}-sticky`;
        const first: Outcome = { accepted: false, detail: 'first' };
        const second: Outcome = { accepted: false, detail: 'second' };
        let hooks = 0;
        // When: an otherwise successful owner ignores two opted-in nested failures.
        await assert.rejects(surface.run(async () => {
          await adapter.insert(id);
          adapter.afterCommit(() => { hooks++; });
          for (const failure of [first, second]) {
            assert.equal(await surface.run(async () => {
              adapter.afterCommit(() => { hooks++; });
              return failure;
            }, resultBoundary), failure);
          }
          assert.equal(await surface.run(async () => 42), 42);
          return { accepted: true, detail: 'ignored' };
        }), (error: unknown) => {
          assert.ok(adapter.isRollbackOnlyError(error));
          assert.equal(error.result, first, 'Later failures and successes cannot replace the first failure.');
          return true;
        });
        // Then: no partial writes or hooks survive the rollback-only owner.
        assert.equal(hooks, 0);
        assert.equal(await adapter.exists(id), false);
        adapter.assertOutside();
      });

      for (const [index, value] of [
        undefined, null, false, 0, '', { ok: false }, { accepted: false }, new Error('returned, not thrown'),
      ].entries()) {
        it(`commits arbitrary value ${index} by default without recognizing a Result shape`, async () => {
          // Given: falsy, Error, and failure-looking values with no rollback predicate.
          const id = `${adapter.name}-${surface.name}-default-${index}`;
          const hooks: string[] = [];
          // When: root and nested callbacks return the exact same arbitrary value.
          const result = await surface.run(async () => {
            adapter.afterCommit(() => { hooks.push('outer'); });
            assert.equal(await surface.run(async () => {
              await adapter.insert(id);
              adapter.afterCommit(() => { hooks.push('inner'); });
              return value;
            }), value);
            return value;
          });
          // Then: opt-in is required; truthiness and conventional fields have no meaning.
          assert.equal(result, value);
          assert.equal(await adapter.exists(id), true);
          assert.deepEqual(hooks, ['outer', 'inner']);
          adapter.assertOutside();
        });
      }

      it('rolls back a primitive through an explicitly typed predicate without a Result convention', async () => {
        // Given: zero is a domain failure only because this boundary says so.
        const id = `${adapter.name}-${surface.name}-primitive`;
        let hooks = 0;
        // When: the public generic boundary evaluates a primitive return value.
        const result = await surface.run(async () => {
          await adapter.insert(id);
          adapter.afterCommit(() => { hooks++; });
          return 0;
        }, {
          shouldRollback: (value: number) => value === 0,
        });
        // Then: opt-in works without requireAfterCommit or a recognized object shape.
        assert.equal(result, 0);
        assert.equal(hooks, 0);
        assert.equal(await adapter.exists(id), false);
        adapter.assertOutside();
      });

      it('propagates native COMMIT errors when the opted-in root predicate accepts its value', async () => {
        // Given: the same native deferred constraint / server failpoint as the legacy case.
        const id = `${adapter.name}-${surface.name}-result-commit-error`;
        const success: Outcome = { accepted: true, detail: id };
        let evaluated = false;
        let hooks = 0;
        // When: policy evaluation succeeds but the real native commit fails.
        await assert.rejects(surface.run(async () => {
          await adapter.insert(id);
          adapter.afterCommit(() => { hooks++; });
          await adapter.failCommit();
          return success;
        }, {
          ...resultBoundary,
          shouldRollback: (value) => {
            assert.equal(value, success);
            evaluated = true;
            return false;
          },
        }), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(adapter.isRollbackOnlyError(error), false);
          assert.equal(adapter.isHookError(error), false);
          return true;
        });
        // Then: a native error is not converted into a successful Result return.
        assert.equal(evaluated, true);
        assert.equal(hooks, 0);
        assert.equal(await adapter.exists(id), false);
        adapter.assertOutside();
      });

      it('commits caught nested throws and hooks even with an explicit Result policy', async () => {
        // Given: a thrown exception, not an opted-in returned failure.
        const id = `${adapter.name}-${surface.name}-caught-result`;
        const failure = new Error('caught application exception');
        const success: Outcome = { accepted: true, detail: id };
        const hooks: string[] = [];
        let innerPredicates = 0;
        // When: the native owner catches a nested application throw.
        const result = await surface.run(async () => {
          adapter.afterCommit(() => { hooks.push('outer'); });
          await assert.rejects(surface.run(async () => {
            await adapter.insert(id);
            adapter.afterCommit(() => { hooks.push('inner'); });
            throw failure;
          }, {
            requireAfterCommit: true,
            shouldRollback: () => { innerPredicates++; return true; },
          }), (error: unknown) => error === failure);
          return success;
        }, resultBoundary);
        // Then: no savepoint or new throw-driven rollback-only behavior was introduced.
        assert.equal(result, success);
        assert.equal(innerPredicates, 0);
        assert.equal(await adapter.exists(id), true);
        assert.deepEqual(hooks, ['outer', 'inner']);
        adapter.assertOutside();
      });
    });
  }

  it(`${adapter.name} isolates simultaneous success and rollback-only owners`, { timeout: 20_000 }, async () => {
    // Given: both entry and release signals exist before either transaction starts.
    const id = `${adapter.name}-concurrent-result`;
    const success: Outcome = { accepted: true, detail: `${id}-success` };
    const failure: Outcome = { accepted: false, detail: `${id}-failure` };
    const successEntered = Promise.withResolvers<void>();
    const failureEntered = Promise.withResolvers<void>();
    const releaseSuccess = Promise.withResolvers<void>();
    const releaseFailure = Promise.withResolvers<void>();
    const hooks: string[] = [];
    let successfulOwner: object | undefined;
    let failingOwner: object | undefined;
    let successfulSettled = false;
    // When: independent native roots overlap and only one becomes rollback-only.
    const successful = adapter.transaction(async () => {
      successfulOwner = adapter.context();
      await adapter.insert(success.detail);
      adapter.afterCommit(() => { hooks.push('success'); });
      successEntered.resolve();
      await releaseSuccess.promise;
      assert.equal(adapter.context(), successfulOwner);
      return success;
    }, resultBoundary).then((value) => {
      successfulSettled = true;
      return value;
    });
    const failed = adapter.transaction(async () => {
      failingOwner = adapter.context();
      await adapter.insert(failure.detail);
      adapter.afterCommit(() => { hooks.push('failure'); });
      failureEntered.resolve();
      await releaseFailure.promise;
      assert.equal(adapter.context(), failingOwner);
      assert.equal(await adapter.transaction(async () => failure, resultBoundary), failure);
      return success;
    }, resultBoundary);
    const failedAssertion = assert.rejects(failed, (error: unknown) => {
      assert.ok(adapter.isRollbackOnlyError(error));
      assert.equal(error.result, failure);
      return true;
    });
    const settled = Promise.allSettled([successful, failedAssertion]);
    try {
      await Promise.all([
        Promise.race([successEntered.promise, successful]),
        Promise.race([failureEntered.promise, failedAssertion]),
      ]);
      assert.ok(successfulOwner);
      assert.ok(failingOwner);
      assert.notEqual(successfulOwner, failingOwner);
      releaseFailure.resolve();
      await failedAssertion;
      assert.equal(successfulSettled, false, 'The successful owner is still blocked on its subscribed barrier.');
      assert.equal(await adapter.exists(failure.detail), false);
      assert.equal(await adapter.exists(success.detail), false);
      assert.deepEqual(hooks, []);
      releaseSuccess.resolve();
      assert.equal(await successful, success);
      // Then: rollback did not taint the independently committed owner or its hooks.
      assert.equal(await adapter.exists(success.detail), true);
      assert.deepEqual(hooks, ['success']);
      adapter.assertOutside();
    } finally {
      releaseFailure.resolve();
      releaseSuccess.resolve();
      await settled;
    }
  });
}

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

describe('native Result rollback completion and failures', { concurrency: false }, () => {
  it('reports Prisma SQL rollback failure hidden by its interactive runner', { timeout: 20_000 }, async () => {
    const disconnected = Promise.withResolvers<void>();
    const nativeErrors: Error[] = [];
    const observation = createPrismaRollbackObserver(new PrismaPg({ connectionString: databaseUrl, max: 1 }, {
      onConnectionError(error) {
        nativeErrors.push(error);
        disconnected.resolve();
      },
    }));
    const native = new PrismaClient({ adapter: observation.adapter });
    const wrapper = new PrismaService(native, { strictTransactions: true, rollbackObserver: observation.rollbackObserver });
    const id = 'Prisma-native-hidden-rollback-error';
    const failure: Outcome = { accepted: false, detail: id };
    let hooks = 0;
    let finished = false;
    try {
      await assert.rejects(wrapper.transaction(async () => {
        await wrapper.current().receipt.create({ data: { id } });
        const [backend] = await wrapper.current().$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        assert.ok(backend);
        wrapper.afterCommit(() => { hooks++; });
        await pool.query('SELECT pg_terminate_backend($1)', [backend.pid]);
        await disconnected.promise;
        finished = true;
        return failure;
      }, undefined, resultBoundary), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof PrismaRollbackOnlyError, false);
        console.log('NATIVE_PRISMA_ROLLBACK_ERROR', JSON.stringify({ name: error.name, message: error.message }));
        return true;
      });
      assert.equal(finished, true);
      assert.ok(nativeErrors.length > 0);
      assert.equal(hooks, 0);
      assert.equal(await client.receipt.findUnique({ where: { id } }), null);
    } finally {
      await wrapper.onApplicationShutdown();
    }
  });

  // Native sentinel identity is not confirmation: the registered public driver
  // observers independently check native SQL/cleanup or correlated Mongo replies.
  for (const [name, wrapper] of [['manual', manual], ['delegated', delegated]] as const) {
    it(`rejects Mongo ${name} rollback without a server acknowledgement`, async () => {
      const failure: Outcome = { accepted: false, detail: 'no server transaction command' };
      let hooks = 0;
      await assert.rejects(wrapper.transaction(async () => {
        wrapper.afterCommit(() => { hooks++; });
        return failure;
      }, resultBoundary), MongooseUnconfirmedError);
      assert.equal(hooks, 0);
      assert.equal(wrapper.currentSession(), undefined);
    });

    it(`rejects Mongo ${name} commandSucceeded carrying writeConcernError`, async () => {
      const native = connection.getClient();
      const id = `Mongo-${name}-abort-write-concern`;
      const failure: Outcome = { accepted: false, detail: id };
      let session: mongoose.mongo.ClientSession | undefined;
      const replies: unknown[] = [];
      let hooks = 0;
      const succeeded = (event: { readonly commandName: string; readonly reply: unknown }) => {
        if (event.commandName === 'abortTransaction') replies.push(event.reply);
      };
      native.on('commandSucceeded', succeeded);
      try {
        await native.db('admin').command({
          configureFailPoint: 'failCommand',
          mode: { times: 1 },
          data: { failCommands: ['abortTransaction'], writeConcernError: { code: 64, errmsg: 'fixture write concern failure' } },
        });
        await assert.rejects(wrapper.transaction(async () => {
          const current = wrapper.currentSession();
          assert.ok(current instanceof mongoose.mongo.ClientSession);
          session = current;
          await wrapper.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
          wrapper.afterCommit(() => { hooks++; });
          return failure;
        }, resultBoundary), (error: unknown) => {
          assert.ok(error instanceof MongooseUnconfirmedError);
          assert.equal(error.cause, replies[0]);
          return true;
        });
        assert.equal(replies.length, 1);
        assert.equal(hooks, 0);
        console.log('NATIVE_MONGO_WRITE_CONCERN_REJECTED', JSON.stringify({ name, replies: replies.length }));
      } finally {
        native.off('commandSucceeded', succeeded);
        await native.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
        if (session?.id) await native.db('admin').command({ killSessions: [session.id] });
      }
    });

    it(`observes Mongo ${name} abort completion before returning the original failure`, async () => {
      // Given: native command observation is installed before opening the boundary.
      const id = `Mongo-${name}-abort-completion`;
      const failure: Outcome = { accepted: false, detail: id };
      const native = connection.getClient();
      const order: string[] = [];
      let hooks = 0;
      const completed = (event: { readonly commandName: string }) => {
        if (event.commandName === 'abortTransaction') order.push('abort');
        if (event.commandName === 'commitTransaction') order.push('commit');
      };
      native.on('commandSucceeded', completed);
      try {
        // When: the real session observes a policy failure after a native insert.
        const result = await wrapper.transaction(async () => {
          const session = wrapper.currentSession();
          assert.ok(session instanceof mongoose.mongo.ClientSession);
          session.once('ended', () => { order.push('ended'); });
          await wrapper.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
          wrapper.afterCommit(() => { hooks++; });
          return failure;
        }, resultBoundary);
        order.push('returned');
        // Then: a return cannot race ahead of abort or the observed session end.
        assert.equal(result, failure);
        assert.deepEqual(order, ['abort', 'ended', 'returned']);
        assert.equal(hooks, 0);
        assert.equal(await Receipt.findById(id).lean().exec(), null);
        assert.equal(wrapper.currentSession(), undefined);
        console.log('NATIVE_RESULT_ROLLBACK', JSON.stringify({ name, order }));
      } finally {
        native.off('commandSucceeded', completed);
      }
    });

    it(`propagates Mongo ${name} server abort errors even when the native driver suppresses them`, async () => {
      // Given: a private one-shot abort failpoint, not a mocked session rejection.
      const id = `Mongo-${name}-abort-server-error`;
      const failure: Outcome = { accepted: false, detail: id };
      const native = connection.getClient();
      let session: mongoose.mongo.ClientSession | undefined;
      const abortErrors: unknown[] = [];
      let hooks = 0;
      let commits = 0;
      const failed = (event: { readonly commandName: string; readonly failure: unknown }) => {
        if (event.commandName === 'abortTransaction') abortErrors.push(event.failure);
      };
      const started = (event: { readonly commandName: string }) => {
        if (event.commandName === 'commitTransaction') commits++;
      };
      native.on('commandFailed', failed);
      native.on('commandStarted', started);
      try {
        await native.db('admin').command({
          configureFailPoint: 'failCommand',
          mode: { times: 1 },
          data: { failCommands: ['abortTransaction'], errorCode: 2 },
        });
        // When: abortTransaction receives an actual non-retryable server error.
        await assert.rejects(wrapper.transaction(async () => {
          const current = wrapper.currentSession();
          assert.ok(current instanceof mongoose.mongo.ClientSession);
          session = current;
          await wrapper.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
          wrapper.afterCommit(() => { hooks++; });
          return failure;
        }, resultBoundary), (error: unknown) => {
          assert.equal(error, abortErrors[0]);
          return true;
        });
        // Then: correlated public command observation defeats native suppression.
        assert.equal(abortErrors.length, 1);
        const [abortError] = abortErrors;
        assert.ok(abortError instanceof mongoose.mongo.MongoServerError);
        assert.equal(abortError.code, 2);
        assert.equal(commits, 0);
        assert.equal(hooks, 0);
        assert.equal(wrapper.currentSession(), undefined);
        console.log('NATIVE_ROLLBACK_CONFIRMED_ERROR', JSON.stringify({
          name, abortFailures: abortErrors.length, commits, nativeErrorCode: 2, exposedByObserver: true,
        }));
      } finally {
        native.off('commandFailed', failed);
        native.off('commandStarted', started);
        await native.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
        // The failed server abort is not evidence of durable rollback. Explicitly
        // kill this fixture session rather than leave its server transaction open.
        if (session?.id) {
          await native.db('admin').command({ killSessions: [session.id] });
        }
      }
    });
  }

  it('propagates a real Drizzle ROLLBACK rejection instead of recovering the failed value', { timeout: 20_000 }, async () => {
    // Given: a dedicated native PostgreSQL connection and an error subscription.
    const victim = new Client({ connectionString: databaseUrl });
    const disconnected = Promise.withResolvers<void>();
    const nativeErrors: Error[] = [];
    const onError = (error: Error) => {
      nativeErrors.push(error);
      disconnected.resolve();
    };
    victim.on('error', onError);
    const observedVictim = createDrizzleRollbackObserver(victim);
    const nativeDatabase = drizzle(observedVictim.client);
    type VictimTransaction = Parameters<Parameters<typeof nativeDatabase.transaction>[0]>[0];
    const wrapper = new DrizzleDatabase<typeof nativeDatabase, VictimTransaction, DrizzleOptions>(
      nativeDatabase, undefined, { strictTransactions: true, rollbackObserver: observedVictim.rollbackObserver },
    );
    const id = 'Drizzle-native-rollback-error';
    const failure: Outcome = { accepted: false, detail: id };
    let callbackFinished = false;
    let hooks = 0;
    try {
      await victim.connect();
      const { rows: [backend] } = await victim.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      assert.ok(backend);
      // When: PostgreSQL terminates this exact backend before the policy asks
      // Drizzle to roll back. The subscription, not a sleep, proves disconnect.
      await assert.rejects(wrapper.transaction(async () => {
        await wrapper.current().insert(table).values({ id });
        wrapper.afterCommit(() => { hooks++; });
        await pool.query('SELECT pg_terminate_backend($1)', [backend.pid]);
        await disconnected.promise;
        callbackFinished = true;
        return failure;
      }, undefined, resultBoundary), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok('query' in error);
        assert.equal(error.query, 'rollback', 'The rejected operation must be native ROLLBACK.');
        assert.ok(error.cause instanceof Error);
        assert.equal(error instanceof DrizzleRollbackOnlyError, false);
        console.log('NATIVE_ROLLBACK_ERROR', JSON.stringify({
          query: error.query, message: error.cause.message,
        }));
        return true;
      });
      // Then: native rollback failure, not the application value, reaches callers.
      assert.equal(callbackFinished, true);
      assert.ok(nativeErrors.length > 0);
      assert.equal(hooks, 0);
      assert.equal((await database.select().from(table).where(eq(table.id, id))).length, 0);
      assert.equal(wrapper.current(), nativeDatabase);
    } finally {
      await wrapper.onApplicationShutdown();
      await victim.end();
      victim.off('error', onError);
    }
  });
});

describe('Mongoose delegated native retries', { concurrency: false }, () => {
  for (const accepted of [true, false]) {
    it(`resets a rollback-only attempt before a native retry ending in accepted=${accepted}`, async () => {
      // Given: a real write conflict will discard an attempt already marked rollback-only.
      const id = `Mongoose-result-retry-${accepted}`;
      const discarded: Outcome = { accepted: false, detail: 'discarded attempt' };
      const final: Outcome = { accepted, detail: id };
      const native = connection.getClient();
      let callbacks = 0;
      let inserts = 0;
      let commits = 0;
      const hooks: number[] = [];
      const countCommands = (event: { readonly commandName: string }) => {
        if (event.commandName === 'insert') inserts++;
        if (event.commandName === 'commitTransaction') commits++;
      };
      native.on('commandStarted', countCommands);
      try {
        await native.db('admin').command({
          configureFailPoint: 'failCommand',
          mode: { times: 1 },
          data: { failCommands: ['insert'], errorCode: 112, errorLabels: ['TransientTransactionError'] },
        });
        // When: only the first native attempt sees the ignored nested failure.
        const result = await delegated.transaction(async () => {
          const attempt = ++callbacks;
          delegated.afterCommit(() => { hooks.push(attempt); });
          if (attempt === 1) {
            assert.equal(await delegated.transaction(async () => discarded, resultBoundary), discarded);
          }
          await delegated.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
          return final;
        }, resultBoundary);
        // Then: retry owns fresh rollback state and hooks, even when its own result fails.
        assert.equal(result, final);
        assert.equal(callbacks, 2);
        assert.equal(inserts, 2);
        assert.equal(commits, accepted ? 1 : 0);
        assert.deepEqual(hooks, accepted ? [2] : []);
        assert.equal((await Receipt.findById(id).lean().exec()) !== null, accepted);
        assert.equal(delegated.currentSession(), undefined);
        console.log('NATIVE_RESULT_RETRY', JSON.stringify({ accepted, callbacks, inserts, commits, hooks }));
      } finally {
        native.off('commandStarted', countCommands);
        await native.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
      }
    });
  }

  for (const [name, wrapper] of [['manual', manual], ['delegated', delegated]] as const) {
    it(`does not treat a Mongo ${name} failed value carrying a transient native error as retryable`, async () => {
      // Given: the returned value is itself a labelled native error, not a throw.
      const id = `Mongoose-${name}-nontransient-result`;
      const failure = new mongoose.mongo.MongoServerError({
        message: 'Returned application failure',
        code: 112,
        errorLabels: ['TransientTransactionError'],
      });
      assert.equal(failure.hasErrorLabel('TransientTransactionError'), true);
      const native = connection.getClient();
      let callbacks = 0;
      let commits = 0;
      let aborts = 0;
      let hooks = 0;
      const completed = (event: { readonly commandName: string }) => {
        if (event.commandName === 'commitTransaction') commits++;
        if (event.commandName === 'abortTransaction') aborts++;
      };
      native.on('commandSucceeded', completed);
      try {
        // When: a shape-independent predicate rejects the returned native error.
        const result = await wrapper.transaction(async () => {
          assert.equal(++callbacks, 1, 'A failed Result must not replay the callback.');
          await wrapper.model<MongooseModelFacade<Promise<unknown>>>('Receipt').create([{ _id: id }]);
          wrapper.afterCommit(() => { hooks++; });
          return failure;
        }, { requireAfterCommit: true, shouldRollback: (value) => value === failure });
        // Then: only a rollback signal reaches the driver; the value keeps its identity.
        assert.equal(result, failure);
        assert.equal(callbacks, 1);
        assert.equal(commits, 0);
        assert.equal(aborts, 1);
        assert.equal(hooks, 0);
        assert.equal(await Receipt.findById(id).lean().exec(), null);
        assert.equal(wrapper.currentSession(), undefined);
      } finally {
        native.off('commandSucceeded', completed);
      }
    });
  }

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
