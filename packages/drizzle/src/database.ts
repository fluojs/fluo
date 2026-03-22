import { AsyncLocalStorage } from 'node:async_hooks';

import {
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@konekti/runtime';
import type { OnApplicationShutdown } from '@konekti/runtime';
import { Inject } from '@konekti/core';

import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS } from './tokens.js';
import type {
  DrizzleDatabaseLike,
  DrizzleHandleProvider,
  DrizzleRuntimeOptions,
  DrizzleTransactionRunner,
} from './types.js';

const TRANSACTION_NOT_SUPPORTED_ERROR = 'Transaction not supported: Drizzle database does not implement transaction.';

type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

@Inject([DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS])
export class DrizzleDatabase<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
> implements DrizzleHandleProvider<TDatabase, TTransactionDatabase, TTransactionOptions>, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TTransactionDatabase>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();

  constructor(
    private readonly database: TDatabase,
    private readonly dispose?: (database: TDatabase) => Promise<void> | void,
    private readonly databaseOptions: DrizzleRuntimeOptions = { strictTransactions: false },
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
    return this.executeTransaction(fn, options, false);
  }

  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T> {
    return this.executeTransaction(fn, options, true, signal);
  }

  private async executeTransaction<T>(
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
    requestScoped: boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    const current = this.transactions.getStore();

    if (current) {
      return fn();
    }

    const transactionRunner = this.resolveTransactionRunner();
    if (!transactionRunner) {
      return fn();
    }

    if (!requestScoped) {
      return transactionRunner((transactionDatabase) => this.transactions.run(transactionDatabase, fn), options);
    }

    return this.executeRequestTransaction(transactionRunner, fn, options, signal);
  }

  private async executeRequestTransaction<T>(
    transactionRunner: DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions>,
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      return await transactionRunner(
        (transactionDatabase) => this.transactions.run(transactionDatabase, () => raceWithAbort(fn, abortContext.signal)),
        options,
      );
    } finally {
      abortContext.cleanup();
      this.untrackActiveRequestTransaction(active);
    }
  }

  private trackActiveRequestTransaction(controller: AbortController): ActiveRequestTransactionHandle {
    return trackActiveRequestTransaction(this.activeRequestTransactions, controller);
  }

  private untrackActiveRequestTransaction(handle: ActiveRequestTransactionHandle): void {
    untrackActiveRequestTransaction(this.activeRequestTransactions, handle);
  }

  private resolveTransactionRunner(): DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions> | undefined {
    if (typeof this.database.transaction !== 'function') {
      if (this.databaseOptions.strictTransactions) {
        throw new Error(TRANSACTION_NOT_SUPPORTED_ERROR);
      }

      return undefined;
    }

    return this.database.transaction.bind(this.database) as DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions>;
  }
}
