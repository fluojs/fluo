import { AsyncLocalStorage } from 'node:async_hooks';

import { raceWithAbort } from '@konekti/runtime';
import type { OnApplicationShutdown } from '@konekti/runtime';
import { Inject } from '@konekti/core';

import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE } from './tokens.js';
import type { DrizzleDatabaseLike, DrizzleHandleProvider } from './types.js';

@Inject([DRIZZLE_DATABASE, DRIZZLE_DISPOSE])
export class DrizzleDatabase<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
> implements DrizzleHandleProvider<TDatabase, TTransactionDatabase, TTransactionOptions>, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TTransactionDatabase>();
  private readonly activeRequestTransactions = new Set<{
    abort(reason?: unknown): void;
    settled: Promise<void>;
  }>();

  constructor(
    private readonly database: TDatabase,
    private readonly dispose?: (database: TDatabase) => Promise<void> | void,
  ) {}

  current(): TDatabase | TTransactionDatabase {
    return this.transactions.getStore() ?? this.database;
  }

  async onApplicationShutdown(): Promise<void> {
    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));

    if (this.dispose) {
      await this.dispose(this.database);
    }
  }

  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T> {
    const current = this.transactions.getStore();

    if (current) {
      return fn();
    }

    if (typeof this.database.transaction !== 'function') {
      return fn();
    }

    return this.database.transaction((transactionDatabase) => this.transactions.run(transactionDatabase, fn), options);
  }

  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T> {
    const current = this.transactions.getStore();

    if (current) {
      return fn();
    }

    if (typeof this.database.transaction !== 'function') {
      return fn();
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);

    signal?.addEventListener('abort', forwardAbort, { once: true });

    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const active = {
      abort(reason?: unknown) {
        controller.abort(reason);
      },
      settled,
    };

    this.activeRequestTransactions.add(active);

    try {
      return await this.database.transaction(
        (transactionDatabase) => this.transactions.run(transactionDatabase, () => raceWithAbort(fn, controller.signal)),
        options,
      );
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      this.activeRequestTransactions.delete(active);
      settle();
    }
  }
}
