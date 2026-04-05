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
import { createDrizzlePlatformStatusSnapshot } from './status.js';
import type {
  DrizzleDatabaseLike,
  DrizzleHandleProvider,
} from './types.js';

const TRANSACTION_NOT_SUPPORTED_ERROR = 'Transaction not supported: Drizzle database does not implement transaction.';
const NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR =
  'Nested Drizzle transaction options are not supported because the active transaction context is reused.';

type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

type DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions> = <T>(
  callback: (database: TTransactionDatabase) => Promise<T>,
  options?: TTransactionOptions,
) => Promise<T>;

type DrizzleRuntimeOptions = {
  strictTransactions: boolean;
};

/**
 * Transaction-aware Drizzle wrapper that integrates request scoping and shutdown handling with the Konekti runtime.
 */
@Inject([DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS])
export class DrizzleDatabase<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
> implements DrizzleHandleProvider<TDatabase, TTransactionDatabase, TTransactionOptions>, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TTransactionDatabase>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private lifecycleState: 'ready' | 'shutting-down' | 'stopped' = 'ready';

  constructor(
    private readonly database: TDatabase,
    private readonly dispose?: (database: TDatabase) => Promise<void> | void,
    private readonly databaseOptions: DrizzleRuntimeOptions = { strictTransactions: false },
  ) {}

  /** Returns the active transaction handle when present, otherwise the root Drizzle database handle. */
  current(): TDatabase | TTransactionDatabase {
    return this.transactions.getStore() ?? this.database;
  }

  /** Aborts active request transactions, waits for settlement, then runs the optional dispose hook. */
  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));

    if (this.dispose) {
      await this.dispose(this.database);
    }

    this.lifecycleState = 'stopped';
  }

  /** Produces the shared persistence status snapshot for platform diagnostics surfaces. */
  createPlatformStatusSnapshot() {
    return createDrizzlePlatformStatusSnapshot({
      activeRequestTransactions: this.activeRequestTransactions.size,
      lifecycleState: this.lifecycleState,
      strictTransactions: this.databaseOptions.strictTransactions,
      supportsTransaction: typeof this.database.transaction === 'function',
    });
  }

  /** Opens a Drizzle transaction boundary or reuses the current one when already inside a transaction. */
  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T> {
    return this.executeTransaction(fn, options, false);
  }

  /** Opens an abort-aware request transaction boundary for the current HTTP request. */
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
      if (options !== undefined) {
        throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
      }

      if (requestScoped && signal) {
        return raceWithAbort(fn, signal);
      }

      return fn();
    }

    const transactionRunner = this.resolveTransactionRunner();
    if (!transactionRunner) {
      if (requestScoped) {
        return this.executeRequestFallback(fn, signal);
      }

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

  private async executeRequestFallback<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      return await raceWithAbort(fn, abortContext.signal);
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
