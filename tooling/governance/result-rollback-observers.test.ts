import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createPrismaRollbackObserver,
  PrismaService,
  TransactionRollbackCapabilityError as PrismaCapabilityError,
  TransactionRollbackUnconfirmedError as PrismaUnconfirmedError,
} from '../../packages/prisma/src/index.js';
import {
  createDrizzleRollbackObserver,
  DrizzleDatabase,
  TransactionRollbackCapabilityError as DrizzleCapabilityError,
  TransactionRollbackUnconfirmedError as DrizzleUnconfirmedError,
} from '../../packages/drizzle/src/index.js';
import {
  createMongooseRollbackObserver,
  MongooseConnection,
  TransactionRollbackCapabilityError as MongooseCapabilityError,
  TransactionRollbackUnconfirmedError as MongooseUnconfirmedError,
} from '../../packages/mongoose/src/index.js';

describe('public rollback observation capabilities', () => {
  it.each(['transaction', 'requestTransaction'] as const)('rejects native but unobserved %s before user work', async (entry) => {
    let nativeCalls = 0;
    let callbacks = 0;
    const nativeRun = async <T>(fn: (handle: object) => Promise<T>) => { nativeCalls++; return fn({}); };
    const prisma = new PrismaService({ $transaction: nativeRun });
    const drizzle = new DrizzleDatabase<{ transaction: typeof nativeRun }, object>({ transaction: nativeRun });
    const mongoose = new MongooseConnection({ startSession: async () => {
      nativeCalls++;
      return { startTransaction() {}, commitTransaction() {}, abortTransaction() {}, endSession() {} };
    } });
    const fn = async () => { callbacks++; return false; };
    const policy = { shouldRollback: () => true };
    const calls = entry === 'transaction'
      ? [prisma.transaction(fn, undefined, policy), drizzle.transaction(fn, undefined, policy), mongoose.transaction(fn, policy)]
      : [prisma.requestTransaction(fn, undefined, undefined, policy), drizzle.requestTransaction(fn, undefined, undefined, policy), mongoose.requestTransaction(fn, undefined, policy)];
    for (const [index, ErrorType] of [PrismaCapabilityError, DrizzleCapabilityError, MongooseCapabilityError].entries()) {
      await expect(calls[index]).rejects.toBeInstanceOf(ErrorType);
    }
    expect(nativeCalls).toBe(0);
    expect(callbacks).toBe(0);
  });

  it.each([undefined, null, false, 0])('preserves arbitrary ordinary thrown values without observation: %s', async (failure) => {
    const run = <T>(callback: (handle: object) => Promise<T>) => callback({});
    const prisma = new PrismaService({ $transaction: run });
    const drizzle = new DrizzleDatabase<{ transaction: typeof run }, object>({ transaction: run });
    const mongoose = new MongooseConnection({ startSession: async () => ({
      startTransaction() {}, commitTransaction() {}, abortTransaction() {}, endSession() {},
    }) });
    const callback = async () => { throw failure; };
    await expect(prisma.transaction(callback)).rejects.toBe(failure);
    await expect(drizzle.transaction(callback)).rejects.toBe(failure);
    await expect(mongoose.transaction(callback)).rejects.toBe(failure);
  });

  it.each(['confirmed', 'sql-only', 'cleanup-only', 'sql-error', 'cleanup-error', 'both-errors'] as const)(
    'Prisma distinguishes %s from positive SQL rollback plus cleanup', async (mode) => {
      const sqlError = new Error('native SQL failure');
      const cleanupError = new Error('native cleanup failure');
      const events: string[] = [];
      const factory = {
        adapterName: '@prisma/adapter-pg',
        async connect() {
          return { async startTransaction() {
            return {
              options: { usePhantomQuery: false },
              async executeRaw(query: { sql: string }) {
                events.push(query.sql);
                if (query.sql === 'ROLLBACK' && (mode === 'sql-error' || mode === 'both-errors')) throw sqlError;
                return 0;
              },
              async rollback() {
                events.push('cleanup');
                if (mode === 'cleanup-error' || mode === 'both-errors') throw cleanupError;
              },
            };
          } };
        },
      };
      const observed = createPrismaRollbackObserver(factory);
      const client = {
        async $transaction<T>(callback: (handle: object) => Promise<T>) {
          const tx = await (await observed.adapter.connect()).startTransaction();
          await tx.executeRaw({ sql: 'BEGIN' });
          try {
            return await callback({});
          } catch (signal) {
            // Public adapter boundary double reproduces Prisma's error suppression;
            // the real PostgreSQL fixture independently verifies this native path.
            const operations = [];
            if (mode !== 'cleanup-only') operations.push(() => tx.executeRaw({ sql: 'ROLLBACK' }));
            if (mode !== 'sql-only') operations.push(() => tx.rollback());
            for (const operation of operations) await Promise.allSettled([operation()]);
            throw signal;
          }
        },
      };
      const wrapper = new PrismaService(client, { strictTransactions: true, rollbackObserver: observed.rollbackObserver });
      const failure = { rejected: true };
      const pending = wrapper.transaction(async () => {
        wrapper.afterCommit(() => { events.push('hook'); });
        return failure;
      }, undefined, { shouldRollback: () => true });
      if (mode === 'confirmed') await expect(pending).resolves.toBe(failure);
      else if (mode === 'sql-only' || mode === 'cleanup-only') await expect(pending).rejects.toBeInstanceOf(PrismaUnconfirmedError);
      else if (mode === 'sql-error') await expect(pending).rejects.toBe(sqlError);
      else if (mode === 'cleanup-error') await expect(pending).rejects.toBe(cleanupError);
      else await expect(pending).rejects.toMatchObject({ errors: [sqlError, cleanupError] });
      expect(events).not.toContain('hook');
    },
  );

  it('rejects Prisma observer/factory mismatches before the callback', async () => {
    expect(() => createPrismaRollbackObserver({ adapterName: 'other', connect() {} })).toThrow(PrismaCapabilityError);
    const observation = createPrismaRollbackObserver({ adapterName: '@prisma/adapter-pg', connect() {} });
    let calls = 0;
    const wrapper = new PrismaService({ $transaction: <T>(fn: (handle: object) => Promise<T>) => fn({}) }, {
      strictTransactions: true, rollbackObserver: observation.rollbackObserver,
    });
    await expect(wrapper.transaction(async () => { calls++; return false; }, undefined, { shouldRollback: () => true }))
      .rejects.toBeInstanceOf(PrismaCapabilityError);
    expect(calls).toBe(0);
  });

  it.each(['confirmed', 'missing-rollback', 'missing-release', 'rollback-error', 'release-error'] as const)(
    'Drizzle distinguishes %s from positive SQL rollback and pooled release', async (mode) => {
      const nativeError = new Error('native failure');
      const raw = {
        async query(query: string) {
          if (query === 'ROLLBACK' && mode === 'rollback-error') throw nativeError;
          return { rows: [] };
        },
        release() { if (mode === 'release-error') throw nativeError; },
      };
      const pool = { query: raw.query, async connect() { return raw; } };
      const observed = createDrizzleRollbackObserver(pool);
      let confirmation: { confirmRollback(): true | Promise<true> } | undefined;
      await observed.rollbackObserver.run(async () => {
        const client = await observed.client.connect();
        await client.query('BEGIN');
        confirmation = observed.rollbackObserver.beginAttempt({});
        if (mode !== 'missing-rollback') await Promise.allSettled([client.query('ROLLBACK')]);
        if (mode !== 'missing-release') await Promise.allSettled([Promise.resolve().then(() => client.release())]);
      });
      if (!confirmation) throw new Error('Missing test observation.');
      if (mode === 'confirmed') await expect(Promise.resolve().then(() => confirmation?.confirmRollback())).resolves.toBe(true);
      else if (mode === 'missing-release' || mode === 'missing-rollback') expect(() => confirmation?.confirmRollback()).toThrow(DrizzleUnconfirmedError);
      else {
        try { confirmation.confirmRollback(); throw new Error('Native failure was hidden.'); }
        catch (error) { expect(error).toBe(nativeError); }
      }
    },
  );

  describe.each(['manual', 'delegated'] as const)('Mongo owning-client admission (%s)', (mode) => {
    for (const entry of ['transaction', 'requestTransaction'] as const) {
      for (const accepted of [true, false]) {
        it.each(['same', 'foreign', 'missing'] as const)(
          `%s client binding for ${entry} with accepted=${accepted}`, async (binding) => {
            const observedClient = Object.assign(new EventEmitter(), { options: { monitorCommands: true } });
            const otherClient = Object.assign(new EventEmitter(), { options: { monitorCommands: true } });
            const sessionClient = binding === 'foreign' ? otherClient : observedClient;
            const observer = createMongooseRollbackObserver(observedClient);
            let callbacks = 0;
            let predicates = 0;
            let commits = 0;
            let cleanups = 0;
            const id = { id: 'owned-session' };
            const acknowledge = (commandName: string, requestId: number, first = false) => {
              const event = { commandName, requestId, connectionId: 'server:27017' };
              sessionClient.emit('commandStarted', {
                ...event,
                command: {
                  lsid: id, txnNumber: 1, autocommit: false,
                  ...(first && { startTransaction: true }),
                },
              });
              sessionClient.emit('commandSucceeded', { ...event, reply: { ok: 1 } });
            };
            const session = {
              id,
              startTransaction() {},
              commitTransaction() { commits++; acknowledge('commitTransaction', 2); },
              abortTransaction() { acknowledge('abortTransaction', 2); },
              endSession() { cleanups++; },
            };
            const native = {
              ...(binding !== 'missing' && { getClient: () => sessionClient }),
              startSession: async () => session,
              ...(mode === 'delegated' && {
                async transaction<T>(fn: (handle: typeof session) => Promise<T>) {
                  session.startTransaction();
                  try {
                    const result = await fn(session);
                    session.commitTransaction();
                    return result;
                  } catch (error) {
                    session.abortTransaction();
                    throw error;
                  } finally {
                    session.endSession();
                  }
                },
              }),
            };
            const wrapper = new MongooseConnection(native, undefined, {
              strictTransactions: true, rollbackObserver: observer,
            });
            const value = { accepted };
            const callback = async () => {
              callbacks++;
              acknowledge('insert', 1, true);
              return value;
            };
            const policy = {
              shouldRollback(result: typeof value) { predicates++; return !result.accepted; },
            };
            const pending = entry === 'transaction'
              ? wrapper.transaction(callback, policy)
              : wrapper.requestTransaction(callback, undefined, policy);
            const outcome = await pending.then(
              (result) => ({ result, error: undefined }),
              (error: unknown) => ({ result: undefined, error }),
            );
            if (binding === 'same') {
              expect(outcome.error).toBeUndefined();
              expect(outcome.result).toBe(value);
              expect(callbacks).toBe(1);
              expect(predicates).toBe(1);
            } else {
              expect.soft(callbacks).toBe(0);
              expect.soft(predicates).toBe(0);
              expect.soft(outcome.error).toBeInstanceOf(MongooseCapabilityError);
              expect.soft(outcome.result).toBeUndefined();
            }
            expect(commits).toBe(binding === 'same' && accepted ? 1 : 0);
            expect(cleanups).toBe(1);
            expect(wrapper.currentSession()).toBeUndefined();
            expect(observedClient.eventNames()).toEqual([]);
            expect(otherClient.eventNames()).toEqual([]);
            await wrapper.onApplicationShutdown();
          },
        );
      }
    }
  });

  it.each(['confirmed', 'absent', 'session', 'transaction', 'request', 'connection', 'write-concern', 'failure', 'pending'] as const)(
    'Mongo requires correlated, complete acknowledgement: %s', async (mode) => {
      const client = Object.assign(new EventEmitter(), { options: { monitorCommands: true } });
      const observer = createMongooseRollbackObserver(client);
      const nativeError = new Error('server rejected abort');
      const session = { id: { id: 'owned-session' } };
      let confirmation: { confirmRollback(): true | Promise<true> } | undefined;
      const started = (commandName: string, requestId: number, command: object) => client.emit('commandStarted', {
        commandName, requestId, connectionId: 'server:27017', command,
      });
      const succeeded = (commandName: string, requestId: number, reply: object, connectionId = 'server:27017') => client.emit('commandSucceeded', {
        commandName, requestId, connectionId, reply,
      });
      await observer.run(async () => {
        confirmation = observer.beginAttempt(session, { getClient: () => client });
        if (mode === 'absent') return;
        const command = { lsid: session.id, txnNumber: 4, autocommit: false };
        started('insert', 1, { ...command, startTransaction: true });
        if (mode !== 'pending') succeeded('insert', 1, { ok: 1 });
        started('abortTransaction', 2, {
          ...command,
          ...(mode === 'session' && { lsid: { id: 'foreign-session' } }),
          ...(mode === 'transaction' && { txnNumber: 5 }),
        });
        if (mode === 'failure') client.emit('commandFailed', {
          commandName: 'abortTransaction', requestId: 2, connectionId: 'server:27017', failure: nativeError,
        });
        else succeeded('abortTransaction', mode === 'request' ? 3 : 2,
          { ok: 1, ...(mode === 'write-concern' && { writeConcernError: { code: 64 } }) },
          mode === 'connection' ? 'foreign:27017' : 'server:27017');
      });
      if (!confirmation) throw new Error('Missing test observation.');
      if (mode === 'confirmed') expect(() => confirmation?.confirmRollback()).not.toThrow();
      else if (mode === 'failure') {
        try { confirmation.confirmRollback(); throw new Error('Native failure was hidden.'); }
        catch (error) { expect(error).toBe(nativeError); }
      } else expect(() => confirmation?.confirmRollback()).toThrow(MongooseUnconfirmedError);
      expect(client.listenerCount('commandStarted')).toBe(0);
      expect(client.listenerCount('commandSucceeded')).toBe(0);
      expect(client.listenerCount('commandFailed')).toBe(0);
    },
  );

  it('shares native listeners across concurrent Mongo owners without losing correlation', async () => {
    const client = Object.assign(new EventEmitter(), { options: { monitorCommands: true } });
    const observer = createMongooseRollbackObserver(client);
    let signalEntered = () => {};
    let signalRelease = () => {};
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const release = new Promise<void>((resolve) => { signalRelease = resolve; });
    let count = 0;
    const pending = Array.from({ length: 12 }, (_, index) => observer.run(async () => {
      const session = { id: { id: `session-${index}` } };
      const observation = observer.beginAttempt(session, { getClient: () => client });
      if (++count === 12) signalEntered();
      await release;
      const command = { lsid: session.id, txnNumber: index + 1, autocommit: false };
      const connectionId = 'server:27017';
      for (const [offset, commandName] of ['insert', 'abortTransaction'].entries()) {
        const requestId = index * 2 + offset;
        client.emit('commandStarted', {
          commandName, requestId, connectionId,
          command: { ...command, ...(offset === 0 && { startTransaction: true }) },
        });
        client.emit('commandSucceeded', { commandName, requestId, connectionId, reply: { ok: 1 } });
      }
      return observation.confirmRollback();
    }));
    try {
      await Promise.race([entered, Promise.all(pending)]);
      expect(count).toBe(12);
      for (const event of ['commandStarted', 'commandSucceeded', 'commandFailed']) {
        expect(client.listenerCount(event)).toBe(1);
      }
      signalRelease();
      expect(await Promise.all(pending)).toEqual(Array.from({ length: 12 }, () => true));
      expect(client.eventNames()).toEqual([]);
    } finally {
      signalRelease();
      await Promise.allSettled(pending);
    }
  });

  it('rejects Mongo monitoring-disabled clients before transaction work', () => {
    const client = Object.assign(new EventEmitter(), { options: { monitorCommands: false } });
    expect(() => createMongooseRollbackObserver(client)).toThrow(MongooseCapabilityError);
    expect(client.eventNames()).toEqual([]);
  });
});
