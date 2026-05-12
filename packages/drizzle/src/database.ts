import { AsyncLocalStorage } from 'node:async_hooks';

import {
  createAbortError,
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@fluojs/runtime';
import type { OnApplicationShutdown } from '@fluojs/runtime';
import { Inject } from '@fluojs/core';

import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS } from './tokens.js';
import { createDrizzlePlatformStatusSnapshot } from './status.js';
import type {
  DrizzleDatabaseLike,
  DrizzleHandleProvider,
} from './types.js';

const TRANSACTION_NOT_SUPPORTED_ERROR = 'Transaction not supported: Drizzle database does not implement transaction.';
const NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR =
  'Nested Drizzle transaction options are not supported because the active transaction context is reused.';
const REQUEST_TRANSACTION_UNAVAILABLE_ERROR = 'Drizzle request transactions are not available during shutdown.';

type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
  statusActive: boolean;
};

type DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions> = <T>(
  callback: (database: TTransactionDatabase) => Promise<T>,
  options?: TTransactionOptions,
) => Promise<T>;

type DrizzleRuntimeOptions = {
  strictTransactions: boolean;
};

type TransactionContext<TTransactionDatabase> = {
  database: TTransactionDatabase;
  deferredRequestTransactionSettlements?: Set<ActiveRequestTransactionHandle>;
  requestAbortSignal?: AbortSignal;
};

type RequestAbortSignalView = {
  cleanup(): void;
  signal: AbortSignal;
};

function createRequestAbortSignalView(parentSignal: AbortSignal, signal?: AbortSignal): RequestAbortSignalView {
  if (!signal) {
    return {
      cleanup() {},
      signal: parentSignal,
    };
  }

  const controller = new AbortController();
  const forwardParentAbort = () => controller.abort(parentSignal.reason);
  const forwardRequestAbort = () => controller.abort(signal.reason);

  if (parentSignal.aborted) {
    forwardParentAbort();
  } else {
    parentSignal.addEventListener('abort', forwardParentAbort, { once: true });
  }

  if (signal.aborted) {
    forwardRequestAbort();
  } else {
    signal.addEventListener('abort', forwardRequestAbort, { once: true });
  }

  return {
    cleanup() {
      parentSignal.removeEventListener('abort', forwardParentAbort);
      signal.removeEventListener('abort', forwardRequestAbort);
    },
    signal: controller.signal,
  };
}

/**
 * Transaction-aware Drizzle wrapper that integrates request scoping and shutdown handling with the Fluo runtime.
 *
 * @typeParam TDatabase Root Drizzle database handle registered in the module.
 * @typeParam TTransactionDatabase Transaction-scoped database handle resolved inside `database.transaction(...)` callbacks.
 * @typeParam TTransactionOptions Options forwarded to the underlying Drizzle transaction runner.
 */
@Inject(DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS)
export class DrizzleDatabase<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
> implements DrizzleHandleProvider<TDatabase, TTransactionDatabase, TTransactionOptions>, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TransactionContext<TTransactionDatabase>>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private activeRequestTransactionStatusCount = 0;
  private lifecycleState: 'ready' | 'shutting-down' | 'stopped' = 'ready';

  constructor(
    private readonly database: TDatabase,
    private readonly dispose?: (database: TDatabase) => Promise<void> | void,
    private readonly databaseOptions: DrizzleRuntimeOptions = { strictTransactions: false },
  ) {}

  /**
   * Returns the active transaction handle when present, otherwise the root Drizzle database handle.
   *
   * @example
   * ```ts
   * return db.current().select().from(users);
   * ```
   *
   * @returns The transaction-scoped database inside an active boundary, or the root database outside one.
   */
  current(): TDatabase | TTransactionDatabase {
    return this.transactions.getStore()?.database ?? this.database;
  }

  /** Aborts active request transactions, waits for settlement, then runs the optional dispose hook. */
  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';
    const activeRequestTransactions = Array.from(this.activeRequestTransactions);

    for (const transaction of activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(activeRequestTransactions.map((transaction) => transaction.settled));

    if (this.dispose) {
      await this.dispose(this.database);
    }

    this.lifecycleState = 'stopped';
  }

  /** Produces the shared persistence status snapshot for platform diagnostics surfaces. */
  createPlatformStatusSnapshot() {
    return createDrizzlePlatformStatusSnapshot({
      activeRequestTransactions: this.activeRequestTransactionStatusCount,
      lifecycleState: this.lifecycleState,
      strictTransactions: this.databaseOptions.strictTransactions,
      supportsTransaction: typeof this.database.transaction === 'function',
    });
  }

  /**
   * Opens a Drizzle transaction boundary or reuses the current one when already inside a transaction.
   *
   * @example
   * ```ts
   * await db.transaction(async () => {
   *   await db.current().insert(users).values(user);
   * });
   * ```
   *
   * @param fn Callback executed inside the transaction scope.
   * @param options Optional transaction options forwarded to `database.transaction(...)`.
   * @returns The callback result after the transaction finishes or the direct-execution fallback completes.
   */
  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T> {
    return this.executeTransaction(fn, options, false);
  }

  /**
   * Opens an abort-aware request transaction boundary for the current HTTP request.
   *
   * @example
   * ```ts
   * await db.requestTransaction(async () => next.handle(), request.signal);
   * ```
   *
   * @param fn Callback executed inside the request transaction scope.
   * @param signal Optional abort signal linked to the request lifecycle.
   * @param options Optional transaction options forwarded to `database.transaction(...)`.
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   */
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

      if (requestScoped) {
        return this.executeNestedRequestTransaction(current, fn, signal);
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
      const deferredRequestTransactionSettlements = new Set<ActiveRequestTransactionHandle>();

      try {
        return await transactionRunner(
          (transactionDatabase) =>
            this.transactions.run(
              { database: transactionDatabase, deferredRequestTransactionSettlements },
              fn,
            ),
          options,
        );
      } finally {
        for (const handle of deferredRequestTransactionSettlements) {
          this.untrackActiveRequestTransaction(handle);
        }
      }
    }

    return this.executeRequestTransaction(transactionRunner, fn, options, signal);
  }

  private async executeRequestTransaction<T>(
    transactionRunner: DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions>,
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      const result = await transactionRunner<T>(
        (transactionDatabase) =>
          this.transactions.run(
            { database: transactionDatabase, requestAbortSignal: abortContext.signal },
            () => raceWithAbort(fn, abortContext.signal),
          ),
        options,
      );

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();
      this.untrackActiveRequestTransaction(active);
    }
  }

  private async executeNestedRequestTransaction<T>(
    current: TransactionContext<TTransactionDatabase>,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (current.requestAbortSignal) {
      const abortSignalView = createRequestAbortSignalView(current.requestAbortSignal, signal);

      try {
        const result = await raceWithAbort(fn, abortSignalView.signal);

        this.throwIfRequestAborted(abortSignalView.signal);

        return result;
      } finally {
        abortSignalView.cleanup();
      }
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    current.deferredRequestTransactionSettlements?.add(active);

    try {
      const result = await this.transactions.run(
        { database: current.database, requestAbortSignal: abortContext.signal },
        () => raceWithAbort(fn, abortContext.signal),
      );

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();

      if (current.deferredRequestTransactionSettlements) {
        this.markRequestTransactionInactiveForStatus(active);
      } else {
        this.untrackActiveRequestTransaction(active);
      }
    }
  }

  private async executeRequestFallback<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      const result = await raceWithAbort(fn, abortContext.signal);

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();
      this.untrackActiveRequestTransaction(active);
    }
  }

  private assertRequestTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(REQUEST_TRANSACTION_UNAVAILABLE_ERROR);
    }
  }

  private throwIfRequestAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }
  }

  private trackActiveRequestTransaction(controller: AbortController): ActiveRequestTransactionHandle {
    const handle = trackActiveRequestTransaction(this.activeRequestTransactions, controller);
    this.activeRequestTransactionStatusCount += 1;

    return { ...handle, statusActive: true };
  }

  private untrackActiveRequestTransaction(handle: ActiveRequestTransactionHandle): void {
    this.markRequestTransactionInactiveForStatus(handle);
    untrackActiveRequestTransaction(this.activeRequestTransactions, handle);
  }

  private markRequestTransactionInactiveForStatus(handle: ActiveRequestTransactionHandle): void {
    if (handle.statusActive) {
      this.activeRequestTransactionStatusCount -= 1;
      handle.statusActive = false;
    }
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
