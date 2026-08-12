import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject } from '@fluojs/core';
import type { OnApplicationShutdown } from '@fluojs/runtime';
import {
  createAbortError,
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@fluojs/runtime';
import { createDrizzlePlatformStatusSnapshot } from './status.js';
import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS } from './tokens.js';
import type {
  DrizzleDatabaseLike,
  DrizzleHandleProvider,
} from './types.js';

const TRANSACTION_NOT_SUPPORTED_ERROR = 'Transaction not supported: Drizzle database does not implement transaction.';
const NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR =
  'Nested Drizzle transaction options are not supported because the active transaction context is reused.';
const TRANSACTION_UNAVAILABLE_ERROR = 'Drizzle transactions are not available during application shutdown.';
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

type ActiveTransactionScope = {
  settled: Promise<void>;
};

type ActiveTransactionScopeHandle = {
  settle(): void;
};

type DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions> = <T>(
  callback: (database: TTransactionDatabase) => Promise<T>,
  options?: TTransactionOptions,
) => Promise<T>;

type DrizzleRuntimeOptions = {
  strictTransactions: boolean;
};

type TransactionBoundaryOwner = {
  closed: boolean;
  readonly callbackSettlements: Set<Promise<void>>;
  readonly requestTransactionSettlements: Set<ActiveRequestTransactionHandle>;
};

type TransactionContext<TDatabase, TTransactionDatabase> = {
  database: TDatabase | TTransactionDatabase;
  deferredRequestTransactionSettlements?: Set<ActiveRequestTransactionHandle>;
  fallbackTransactionOwner?: TransactionBoundaryOwner;
  inheritedRequestAbortSignal?: AbortSignal;
  requestAbortSignal?: AbortSignal;
  transactionBoundaryOwner: TransactionBoundaryOwner;
};

type RequestAbortSignalView = {
  cleanup(): void;
  signal: AbortSignal;
};

function createCurrentlessDrizzleFacade<TTarget extends { current(): unknown }>(
  target: TTarget,
): TTarget {
  return new Proxy(target, {
    get(database, prop) {
      if (prop in database) {
        const value = Reflect.get(database, prop, database);

        if (typeof value === 'function') {
          return value.bind(database);
        }

        return value;
      }

      const currentDatabase = database.current() as Record<PropertyKey, unknown>;
      const value = Reflect.get(currentDatabase, prop, currentDatabase);

      if (typeof value === 'function') {
        return value.bind(currentDatabase);
      }

      return value;
    },
  });
}

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
  private readonly transactions = new AsyncLocalStorage<TransactionContext<TDatabase, TTransactionDatabase>>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private readonly activeTransactionScopes = new Set<ActiveTransactionScope>();
  private activeRequestTransactionStatusCount = 0;
  private lifecycleState: 'ready' | 'shutting-down' | 'stopped' = 'ready';

  constructor(
    private readonly database: TDatabase,
    private readonly dispose?: (database: TDatabase) => Promise<void> | void,
    private readonly databaseOptions: DrizzleRuntimeOptions = { strictTransactions: false },
  ) {}

  /**
   * Creates the low-level DI facade that forwards unknown Drizzle API properties to the ambient `current()` handle.
   *
   * @remarks
   * This compatibility helper is used by `DrizzleModule` provider wiring. Application code should prefer
   * `DrizzleModule.forRoot(...)` or `DrizzleModule.forRootAsync(...)`, then type injected repository handles as
   * `DrizzleDatabaseFacade<TDatabase>` when direct Drizzle methods are needed. Wrapper and lifecycle methods remain
   * bound to the lifecycle owner while unknown Drizzle query properties forward to the ambient `current()` handle.
   *
   * @param database Root Drizzle database handle registered in the module.
   * @param dispose Optional shutdown hook used to close pools or driver resources.
   * @param databaseOptions Runtime transaction options consumed by the Fluo wrapper.
   * @returns A transaction-aware facade that exposes wrapper methods plus the root Drizzle handle surface.
   */
  static createFacade<
    TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = TDatabase,
    TTransactionOptions = unknown,
  >(
    database: TDatabase,
    dispose?: (database: TDatabase) => Promise<void> | void,
    databaseOptions: DrizzleRuntimeOptions = { strictTransactions: false },
  ): DrizzleDatabaseFacade<TDatabase, TTransactionDatabase, TTransactionOptions> {
    return createCurrentlessDrizzleFacade(
      new DrizzleDatabase<TDatabase, TTransactionDatabase, TTransactionOptions>(database, dispose, databaseOptions),
    ) as DrizzleDatabaseFacade<TDatabase, TTransactionDatabase, TTransactionOptions>;
  }

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
    const current = this.transactions.getStore();

    if (!current || current.transactionBoundaryOwner.closed) {
      return this.database;
    }

    return current.database;
  }

  /** Aborts active request transactions, waits for settlement, then runs the optional dispose hook. */
  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';
    const activeRequestTransactions = Array.from(this.activeRequestTransactions);

    for (const transaction of activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled([
      ...activeRequestTransactions.map((transaction) => transaction.settled),
      ...Array.from(this.activeTransactionScopes, (transaction) => transaction.settled),
    ]);

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
      if (current.transactionBoundaryOwner.closed) {
        if (requestScoped) {
          return this.executeInheritedRequestTransaction(current, fn, options, signal);
        }

        return this.executeManualRootTransaction(fn, options);
      }

      if (!requestScoped) {
        return this.executeNestedManualTransaction(current.transactionBoundaryOwner, fn, options);
      }

      if (requestScoped) {
        this.assertRequestTransactionsAvailable();
      } else {
        this.assertTransactionsAvailable();
      }

      if (requestScoped) {
        return this.executeNestedRequestTransaction(current, fn, signal);
      }
    }

    if (!requestScoped) {
      return this.executeManualRootTransaction(fn, options);
    }

    return this.executeRequestRootTransaction(fn, options, signal);
  }

  private async executeManualRootTransaction<T>(
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
  ): Promise<T> {
    const deferredRequestTransactionSettlements = new Set<ActiveRequestTransactionHandle>();
    const fallbackTransactionOwner: TransactionBoundaryOwner = {
      closed: false,
      callbackSettlements: new Set(),
      requestTransactionSettlements: new Set(),
    };
    const activeTransactionScope = this.trackAvailableTransactionScope();

    try {
      const transactionRunner = this.resolveTransactionRunner();

      if (!transactionRunner) {
        try {
          return await this.transactions.run(
            {
              database: this.database,
              fallbackTransactionOwner,
              transactionBoundaryOwner: fallbackTransactionOwner,
            },
            fn,
          );
        } finally {
          await this.closeTransactionBoundaryOwner(fallbackTransactionOwner);
        }
      }

      return await transactionRunner(
        async (transactionDatabase) => {
          try {
            return await this.transactions.run(
              {
                database: transactionDatabase,
                deferredRequestTransactionSettlements,
                transactionBoundaryOwner: fallbackTransactionOwner,
              },
              fn,
            );
          } finally {
            await this.closeTransactionBoundaryOwner(fallbackTransactionOwner);
          }
        },
        options,
      );
    } finally {
      await this.closeTransactionBoundaryOwner(fallbackTransactionOwner);

      for (const handle of fallbackTransactionOwner.requestTransactionSettlements) {
        this.untrackActiveRequestTransaction(handle);
      }

      for (const handle of deferredRequestTransactionSettlements) {
        this.untrackActiveRequestTransaction(handle);
      }

      activeTransactionScope.settle();
    }
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
    const transactionBoundaryOwner: TransactionBoundaryOwner = {
      closed: false,
      callbackSettlements: new Set(),
      requestTransactionSettlements: new Set(),
    };

    try {
      const result = await transactionRunner<T>(
        async (transactionDatabase) => {
          try {
            return await this.transactions.run(
              {
                database: transactionDatabase,
                inheritedRequestAbortSignal: signal ?? abortContext.signal,
                requestAbortSignal: abortContext.signal,
                transactionBoundaryOwner,
              },
              () => raceWithAbort(fn, abortContext.signal),
            );
          } finally {
            await this.closeTransactionBoundaryOwner(transactionBoundaryOwner);
          }
        },
        options,
      );

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      transactionBoundaryOwner.closed = true;
      abortContext.cleanup();
      this.untrackActiveRequestTransaction(active);
    }
  }

  private async executeRequestRootTransaction<T>(
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const transactionRunner = this.resolveTransactionRunner();

    if (!transactionRunner) {
      return this.executeRequestFallback(fn, signal);
    }

    return this.executeRequestTransaction(transactionRunner, fn, options, signal);
  }

  private async executeInheritedRequestTransaction<T>(
    current: TransactionContext<TDatabase, TTransactionDatabase>,
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const inheritedRequestAbortSignal = current.inheritedRequestAbortSignal ?? current.requestAbortSignal;

    if (!inheritedRequestAbortSignal) {
      return this.executeRequestRootTransaction(fn, options, signal);
    }

    const abortSignalView = createRequestAbortSignalView(inheritedRequestAbortSignal, signal);

    try {
      this.throwIfRequestAborted(abortSignalView.signal);
      return await this.executeRequestRootTransaction(fn, options, abortSignalView.signal);
    } finally {
      abortSignalView.cleanup();
    }
  }

  private async executeNestedManualTransaction<T>(
    owner: TransactionBoundaryOwner,
    fn: () => Promise<T>,
    options: TTransactionOptions | undefined,
  ): Promise<T> {
    this.assertTransactionsAvailable();

    if (options !== undefined) {
      throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
    }

    const callback = Promise.resolve().then(fn);
    const removeSettlement = () => {
      owner.callbackSettlements.delete(settlement);
    };
    const settlement = callback.then(removeSettlement, removeSettlement);
    owner.callbackSettlements.add(settlement);

    return callback;
  }

  private async executeNestedRequestTransaction<T>(
    current: TransactionContext<TDatabase, TTransactionDatabase>,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const fallbackTransactionOwner = current.fallbackTransactionOwner;

    if (fallbackTransactionOwner?.closed) {
      if (current.requestAbortSignal) {
        const abortSignalView = createRequestAbortSignalView(current.requestAbortSignal, signal);

        try {
          return await this.executeRequestFallback(fn, abortSignalView.signal);
        } finally {
          abortSignalView.cleanup();
        }
      }

      return this.executeRequestFallback(fn, signal);
    }

    const runCallback = () => {
      const callback = fn();

      if (fallbackTransactionOwner) {
        const removeSettlement = () => {
          fallbackTransactionOwner.callbackSettlements.delete(settlement);
        };
        const settlement = callback.then(removeSettlement, removeSettlement);
        fallbackTransactionOwner.callbackSettlements.add(settlement);
      }

      return callback;
    };

    if (current.requestAbortSignal) {
      const abortSignalView = createRequestAbortSignalView(current.requestAbortSignal, signal);

      try {
        const result = await raceWithAbort(runCallback, abortSignalView.signal);

        this.throwIfRequestAborted(abortSignalView.signal);

        return result;
      } finally {
        abortSignalView.cleanup();
      }
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    let ownerDefersSettlement = false;

    if (fallbackTransactionOwner) {
      fallbackTransactionOwner.requestTransactionSettlements.add(active);
      ownerDefersSettlement = true;
    } else if (current.deferredRequestTransactionSettlements) {
      current.deferredRequestTransactionSettlements.add(active);
      ownerDefersSettlement = true;
    }

    try {
      const result = await this.transactions.run(
        {
          database: current.database,
          fallbackTransactionOwner,
          inheritedRequestAbortSignal: current.inheritedRequestAbortSignal,
          requestAbortSignal: abortContext.signal,
          transactionBoundaryOwner: current.transactionBoundaryOwner,
        },
        () => raceWithAbort(runCallback, abortContext.signal),
      );

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();

      if (ownerDefersSettlement) {
        this.markRequestTransactionInactiveForStatus(active);
      } else {
        this.untrackActiveRequestTransaction(active);
      }
    }
  }

  private async executeRequestFallback<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);

    if (abortContext.signal.aborted) {
      const abortError = createAbortError(abortContext.signal.reason);
      abortContext.cleanup();
      throw abortError;
    }

    const active = this.trackActiveRequestTransaction(abortContext.controller);
    const fallbackTransactionOwner: TransactionBoundaryOwner = {
      closed: false,
      callbackSettlements: new Set(),
      requestTransactionSettlements: new Set(),
    };

    try {
      const result = await raceWithAbort(() => {
        const callback = new Promise<T>((resolve) =>
          resolve(
            this.transactions.run(
              {
                database: this.database,
                fallbackTransactionOwner,
                inheritedRequestAbortSignal: signal ?? abortContext.signal,
                requestAbortSignal: abortContext.signal,
                transactionBoundaryOwner: fallbackTransactionOwner,
              },
              fn,
            ),
          ),
        );

        return callback.finally(async () => {
          await this.closeTransactionBoundaryOwner(fallbackTransactionOwner);

          for (const handle of fallbackTransactionOwner.requestTransactionSettlements) {
            this.untrackActiveRequestTransaction(handle);
          }

          this.untrackActiveRequestTransaction(active);
        });
      }, abortContext.signal);

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();
    }
  }

  private async closeTransactionBoundaryOwner(owner: TransactionBoundaryOwner): Promise<void> {
    while (owner.callbackSettlements.size > 0) {
      await Promise.all(owner.callbackSettlements);
    }

    owner.closed = true;
  }

  private assertRequestTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(REQUEST_TRANSACTION_UNAVAILABLE_ERROR);
    }
  }

  private assertTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(TRANSACTION_UNAVAILABLE_ERROR);
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

  private trackActiveTransactionScope(): ActiveTransactionScopeHandle {
    let settle!: () => void;
    const active: ActiveTransactionScope = {
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };

    this.activeTransactionScopes.add(active);

    return {
      settle: () => {
        this.activeTransactionScopes.delete(active);
        settle();
      },
    };
  }

  private trackAvailableTransactionScope(): ActiveTransactionScopeHandle {
    this.assertTransactionsAvailable();

    return this.trackActiveTransactionScope();
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

/**
 * Injection-facing Drizzle facade type that combines the Fluo wrapper methods with the registered database handle.
 *
 * @remarks
 * `DrizzleModule` resolves `DrizzleDatabase` to a proxy that forwards unknown properties to `current()`. Use this type
 * in repositories that call Drizzle query methods directly, and use `DrizzleDatabase<TDatabase>` when only the wrapper
 * methods (`current()`, `transaction(...)`, `requestTransaction(...)`, and status snapshots) are needed.
 *
 * @typeParam TDatabase Root Drizzle database handle registered in the module.
 * @typeParam TTransactionDatabase Transaction-scoped database handle resolved inside `database.transaction(...)` callbacks.
 * @typeParam TTransactionOptions Options forwarded to the underlying Drizzle transaction runner.
 */
export type DrizzleDatabaseFacade<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
> = DrizzleDatabase<TDatabase, TTransactionDatabase, TTransactionOptions> &
  Omit<TDatabase, keyof DrizzleDatabase<TDatabase, TTransactionDatabase, TTransactionOptions>>;
