import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { describe, expect, it } from 'vitest';
import { DrizzleDatabase } from './index.js';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe('@fluojs/drizzle native request abort propagation', () => {
  it('propagates a nested request abort signal to descendant request transactions with the async native driver', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fluo-drizzle-request-abort-'));
    const client = createClient({ url: `file:${join(directory, 'database.sqlite')}` });

    try {
      await client.execute('CREATE TABLE entries (name TEXT NOT NULL)');

      const driver = drizzle(client);
      type NativeTransactionHandle = Parameters<Parameters<typeof driver.transaction>[0]>[0];
      let transactionRunnerCalls = 0;
      const database = {
        async transaction<T>(callback: (value: NativeTransactionHandle) => Promise<T>): Promise<T> {
          transactionRunnerCalls += 1;
          return driver.transaction(async (transaction) => callback(transaction));
        },
      };
      const wrapper = new DrizzleDatabase<typeof database, NativeTransactionHandle>(database, undefined, {
        strictTransactions: true,
      });
      const rootController = new AbortController();
      const nestedController = new AbortController();
      const nestedContinuation = createDeferred();
      const nestedRejectionObserved = createDeferred();
      const descendantObserved = createDeferred();
      let descendantCalls = 0;
      let intermediateError: Error | undefined;
      let descendantError: Error | undefined;

      const requestTransaction = wrapper.requestTransaction(
        async () => {
          try {
            await wrapper.requestTransaction(async () => {
              nestedController.abort(new Error('nested native request aborted'));
              await nestedContinuation.promise;
              try {
                await wrapper.requestTransaction(async () => {
                  descendantCalls += 1;
                  await (wrapper.current() as NativeTransactionHandle).run(sql`INSERT INTO entries (name) VALUES ('descendant')`);
                  return 'descendant-unreachable';
                });
              } catch (error) {
                descendantError = error as Error;
              }
              descendantObserved.resolve();
              return 'nested-unreachable';
            }, nestedController.signal);
          } catch (error) {
            intermediateError = error as Error;
          }
          nestedRejectionObserved.resolve();
          return 'root-ok';
        },
        rootController.signal,
      );

      try {
        await nestedRejectionObserved.promise;
        expect(rootController.signal.aborted).toBe(false);

        nestedContinuation.resolve();
        await descendantObserved.promise;

        await expect(requestTransaction).resolves.toBe('root-ok');

        expect(descendantCalls).toBe(0);
        expect(transactionRunnerCalls).toBe(1);
        expect(intermediateError?.name).toBe('AbortError');
        expect(intermediateError?.message).toBe('nested native request aborted');
        expect(descendantError?.name).toBe('AbortError');
        expect(descendantError?.message).toBe(intermediateError?.message);
        expect(rootController.signal.aborted).toBe(false);
        expect(nestedController.signal.aborted).toBe(true);
        expect(Number((await client.execute('SELECT count(*) AS count FROM entries')).rows[0]?.count)).toBe(0);
      } finally {
        nestedContinuation.resolve();
        await Promise.allSettled([requestTransaction]);
      }
    } finally {
      client.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
