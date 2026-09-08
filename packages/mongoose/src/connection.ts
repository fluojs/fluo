import { observeRollback, type TransactionRollbackObserver } from './result-rollback.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject } from '@fluojs/core';
import type { OnApplicationShutdown } from '@fluojs/runtime';
import {
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@fluojs/runtime';
import { AfterCommitCapabilityError, AfterCommitCleanupError, AfterCommitError } from './after-commit.js';
import { evaluateResult, ResultBoundary, type RollbackOwner, TransactionRollbackCapabilityError } from './result-rollback.js';
import { createMongoosePlatformStatusSnapshot } from './status.js';
import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import type {
  AfterCommitCallback,
  MongooseConnectionLike,
  MongooseHandleProvider,
  MongooseModelFacade,
  MongooseSessionLike,
  TransactionBoundaryOptions,
} from './types.js';

const TRANSACTIONS_NOT_SUPPORTED_ERROR = 'Transaction not supported: Mongoose connection does not implement startSession.';
const TRANSACTION_UNAVAILABLE_ERROR = 'Mongoose transactions are unavailable during application shutdown.';

type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

type ActiveSessionScope = {
  settled: Promise<void>;
};

type ActiveTransactionCallback = {
  settled: Promise<void>;
};

type ActiveTransactionCallbackHandle = {
  settle(): void;
};

type ActiveSessionScopeHandle = {
  confirmCommit(): void;
  retainRequestTransaction(handle: ActiveRequestTransactionHandle): void;
  settle(): void;
};

type AmbientSessionScope = {
  activeSession: ActiveSessionScopeHandle;
  session: MongooseSessionLike;
  readonly owner: TransactionOwner;
};

// Each native callback attempt owns a mutable registration queue and closes it before commit begins.
type TransactionOwner = RollbackOwner & {
  readonly callbacks: AfterCommitCallback[];
  afterCommitEnabled: boolean;
  resultRollbackEnabled: boolean;
  open: boolean;
};

type MongooseRuntimeOptions = {
  strictTransactions: boolean;
  rollbackObserver?: TransactionRollbackObserver;
};

type MongooseModelFactoryConnection = MongooseConnectionLike & {
  model?(name: string, ...args: unknown[]): MongooseModelFacade;
};

const MODEL_OPERATIONS_WITH_OPTIONS = new Set<PropertyKey>(['aggregate', 'bulkWrite', 'create', 'find', 'findOne']);
const MODEL_OPERATIONS_WITH_PROJECTION = new Set<PropertyKey>(['find', 'findOne']);
function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function resolveCreateOptionsIndex(operationArgs: unknown[]): number | undefined {
  if (Array.isArray(operationArgs[0])) {
    return 1;
  }

  return undefined;
}

function resolveAggregateOptionsIndex(): number {
  return 1;
}

function resolveOptionsIndex(operation: PropertyKey, operationArgs: unknown[]): number | undefined {
  if (operation === 'create') {
    return resolveCreateOptionsIndex(operationArgs);
  }

  if (operation === 'aggregate') {
    return resolveAggregateOptionsIndex();
  }

  if (!MODEL_OPERATIONS_WITH_PROJECTION.has(operation)) {
    return operationArgs.length > 1 ? 1 : operationArgs.length;
  }

  if (operationArgs.length >= 3) {
    return 2;
  }

  if (operationArgs.length <= 1) {
    return 2;
  }

  return operationArgs.length;
}

function resolveSessionOptions(opts: unknown, ambient: MongooseSessionLike): Record<string, unknown> {
  const options = opts && typeof opts === 'object' ? opts as Record<string, unknown> : {};

  if (options.session === null) {
    throw new Error('Explicit session: null conflicts with ambient transaction session');
  }

  if (options.session !== undefined && options.session !== ambient) {
    throw new Error('Explicit session conflicts with ambient transaction session');
  }

  return { ...options, session: ambient };
}

function createAmbientSessionModelFacade<TModel extends MongooseModelFacade>(model: TModel, ambient: MongooseSessionLike): TModel {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (!MODEL_OPERATIONS_WITH_OPTIONS.has(prop) || typeof value !== 'function') {
        return value;
      }

      return (...args: unknown[]) => {
        const operationArgs = [...args];
        const optionsIndex = resolveOptionsIndex(prop, operationArgs);

        if (optionsIndex === undefined) {
          return value.apply(target, operationArgs);
        }

        operationArgs[optionsIndex] = resolveSessionOptions(operationArgs[optionsIndex], ambient);

        return value.apply(target, operationArgs);
      };
    },
  });
}

async function raceWithAbortAndDrainCallback<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  shouldDrainAfterAbort: () => boolean = () => true,
): Promise<T> {
  let callback: Promise<T> | undefined;

  try {
    return await raceWithAbort(() => {
      callback = Promise.resolve().then(fn);
      return callback;
    }, signal);
  } catch (error) {
    if (signal.aborted && callback && shouldDrainAfterAbort()) {
      await callback.then(
        () => undefined,
        () => undefined,
      );
    }

    throw error;
  }
}

function resolveModelFactory(connection: MongooseConnectionLike): MongooseModelFactoryConnection['model'] | undefined {
  if (!isObjectLike(connection)) {
    return undefined;
  }

  const modelConnection = connection as MongooseModelFactoryConnection;

  return modelConnection.model;
}

function assertRollbackSessionCapability(session: MongooseSessionLike): void {
  if (!isObjectLike(session) || ['startTransaction', 'commitTransaction', 'abortTransaction', 'endSession']
    .some((method) => typeof Reflect.get(session, method) !== 'function')) {
    throw new TransactionRollbackCapabilityError();
  }
}

async function executeSessionTransaction<T>(
  session: MongooseSessionLike,
  fn: () => Promise<T>,
  owner: TransactionOwner,
): Promise<T> {
  try {
    await session.startTransaction();
    const result = await fn();
    await session.commitTransaction();
    return result;
  } catch (error: unknown) {
    try {
      await session.abortTransaction();
    } catch (abortError) {
      if (owner.resultRollbackEnabled) {
        throw new AggregateError([error, abortError], 'Mongoose transaction failed and native rollback failed.', { cause: error });
      }
    }

    throw error;
  }
}

/**
 * Session-aware Mongoose wrapper that integrates request scoping and shutdown handling with the Fluo runtime.
 *
 * @typeParam TConnection Root Mongoose connection shape registered in the module.
 */
@Inject(MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS)
export class MongooseConnection<TConnection extends MongooseConnectionLike = MongooseConnectionLike>
  implements MongooseHandleProvider<TConnection>, OnApplicationShutdown
{
  private readonly sessions = new AsyncLocalStorage<AmbientSessionScope>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private readonly activeSessions = new Set<ActiveSessionScope>();
  private readonly activeTransactionCallbacks = new Set<ActiveTransactionCallback>();
  private lifecycleState: 'ready' | 'shutting-down' | 'stopped' = 'ready';

  constructor(
    private readonly connection: TConnection,
    private readonly dispose?: (connection: TConnection) => Promise<void> | void,
    private readonly connectionOptions: MongooseRuntimeOptions = { strictTransactions: false },
  ) {}

  /**
   * Returns the root Mongoose connection handle.
   *
   * @example
   * ```ts
   * const User = conn.current().model('User');
   * ```
   *
   * @returns The registered Mongoose connection.
   */
  current(): TConnection {
    return this.connection;
  }

  /**
   * Returns the active Mongoose session for the current async context, if one exists.
   *
   * @example
   * ```ts
   * const session = conn.currentSession();
   * ```
   *
   * @returns The ambient session inside a transaction boundary, or `undefined` outside one.
   */
  currentSession(): MongooseSessionLike | undefined {
    const scope = this.sessions.getStore();
    return scope?.owner.open ? scope.session : undefined;
  }

  /**
   * Registers work synchronously on the active native transaction callback.
   *
   * @remarks
   * Nested calls share the owning callback queue. Only the final successful native attempt is drained,
   * sequentially in registration order, after commit and outside the ended session context.
   *
   * @param callback Hook to run after the outer native transaction commits.
   * @throws {AfterCommitCapabilityError} When called outside a native callback or after its scope closes.
   */
  afterCommit(callback: AfterCommitCallback): void {
    const owner = this.sessions.getStore()?.owner;
    if (!owner?.open) {
      throw new AfterCommitCapabilityError();
    }

    owner.afterCommitEnabled = true;
    owner.callbacks.push(callback);
  }

  /**
   * Saves a Mongoose document with the active transaction session.
   *
   * This opt-in helper preserves the document instance and forwards caller-provided save options.
   * It does not patch document instances, prototypes, or model caches.
   *
   * @typeParam TSaveOptions Options accepted by the document's native `save()` method.
   * @typeParam TDocument Mongoose document-like value being saved.
   * @param document Existing Mongoose document to save.
   * @param options Native Mongoose save options to preserve while attaching the ambient session.
   * @returns The same document instance after its native save operation completes.
   * @throws When called outside an active transaction or with a conflicting explicit session.
   */
  async saveDocument<
    TSaveOptions extends object,
    TDocument extends { save(options?: TSaveOptions): Promise<TDocument> },
  >(document: TDocument, options?: TSaveOptions): Promise<TDocument> {
    const session = this.currentSession();
    if (!session) {
      throw new Error('Mongoose document saves require an active transaction session.');
    }

    return document.save(resolveSessionOptions(options, session) as TSaveOptions);
  }

  /**
   * Returns a model from the root connection, injecting the ambient transaction session into conservative operations.
   *
   * @typeParam TModel Consumer-defined facade result contract for the wrapped model.
   * @param name Model name passed to the underlying Mongoose connection.
   * @param args Additional model resolver arguments forwarded unchanged.
   * @returns The real model outside transactions, or a model facade inside an active transaction boundary.
   */
  model<TModel extends MongooseModelFacade = MongooseModelFacade>(name: string, ...args: unknown[]): TModel;
  model(name: string, ...args: unknown[]): MongooseModelFacade {
    const modelFactory = resolveModelFactory(this.connection);

    if (typeof modelFactory !== 'function') {
      throw new Error('Mongoose connection does not implement model().');
    }

    const model = modelFactory.call(this.connection, name, ...args);
    const ambient = this.currentSession();

    return ambient ? createAmbientSessionModelFacade(model, ambient) : model;
  }

  /** Aborts active request transactions, waits for settlement, then runs the optional dispose hook. */
  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled([
      ...Array.from(this.activeRequestTransactions, (transaction) => transaction.settled),
      ...Array.from(this.activeSessions, (session) => session.settled),
      ...Array.from(this.activeTransactionCallbacks, (callback) => callback.settled),
    ]);

    if (this.dispose) {
      await this.dispose(this.connection);
    }

    this.lifecycleState = 'stopped';
  }

  /** Produces the shared persistence status snapshot for platform diagnostics surfaces. */
  createPlatformStatusSnapshot() {
    return createMongoosePlatformStatusSnapshot({
      activeRequestTransactions: this.activeRequestTransactions.size,
      activeSessions: this.activeSessions.size,
      hasActiveSession: this.activeSessions.size > 0,
      lifecycleState: this.lifecycleState,
      strictTransactions: this.connectionOptions.strictTransactions,
      supportsConnectionTransaction: typeof this.connection.transaction === 'function',
      supportsStartSession: typeof this.connection.startSession === 'function',
    });
  }

  /**
   * Opens a Mongoose session transaction boundary or reuses the current one when already active.
   *
   * @example
   * ```ts
   * await conn.transaction(async () => {
   *   await User.create([{ name: 'Ada' }], { session: conn.currentSession() });
   * });
   * ```
   *
   * @param fn Callback executed within the transaction scope.
   * @param boundary Optional native capability requirements and application-owned Result rollback predicate.
   * @returns The callback result after the session transaction finishes or the direct-execution fallback completes.
   * @throws {AfterCommitError} After committed work when one or more hooks fail.
   * @throws {AfterCommitCleanupError} After committed work and hook drain when manual session cleanup fails.
   * @throws {AfterCommitCapabilityError} When required native support is unavailable.
   * @throws {TransactionRollbackCapabilityError} When Result rollback cannot own a native boundary.
   * @throws {TransactionRollbackOnlyError} When a nested Result rejected but the root result did not.
   */
  async transaction<T>(fn: () => Promise<T>, boundary?: TransactionBoundaryOptions<T>): Promise<T> {
    this.assertTransactionsAvailable();
    this.assertResultRollbackCapability(boundary);
    this.assertAfterCommitCapability(boundary);

    const currentSession = this.sessions.getStore();
    if (currentSession?.owner.open) {
      currentSession.owner.afterCommitEnabled ||= boundary?.requireAfterCommit === true;
      currentSession.owner.resultRollbackEnabled ||= boundary?.shouldRollback !== undefined;
      return evaluateResult(currentSession.owner, await fn(), boundary?.shouldRollback);
    }

    if (typeof this.connection.transaction === 'function') {
      return this.runConnectionTransaction(fn, undefined, boundary);
    }

    const activeCallback = this.trackActiveTransactionCallback();
    let session: MongooseSessionLike | undefined;

    try {
      session = await this.resolveSession();
    } catch (error) {
      activeCallback.settle();
      throw error;
    }

    if (!session) {
      if (boundary?.shouldRollback) {
        activeCallback.settle();
        throw new TransactionRollbackCapabilityError();
      }
      return this.runDirectTransaction(fn, activeCallback);
    }

    return this.runManualSessionTransaction(session, fn, activeCallback, undefined, boundary);
  }

  /**
   * Opens an abort-aware request transaction boundary for the current HTTP request.
   *
   * @example
   * ```ts
   * await conn.requestTransaction(async () => next.handle(), request.signal);
   * ```
   *
   * @param fn Callback executed within the request transaction scope.
   * @param signal Optional abort signal linked to the request lifecycle.
   * @param boundary Optional native capability requirements and application-owned Result rollback predicate.
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   * @throws {AfterCommitError} After committed work when one or more hooks fail.
   * @throws {AfterCommitCleanupError} After committed work and hook drain when manual session cleanup fails.
   * @throws {AfterCommitCapabilityError} When required native support is unavailable.
   * @throws {TransactionRollbackCapabilityError} When Result rollback cannot own a native boundary.
   * @throws {TransactionRollbackOnlyError} When a nested Result rejected but the root result did not.
   */
  async requestTransaction<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
    boundary?: TransactionBoundaryOptions<T>,
  ): Promise<T> {
    this.assertRequestTransactionsAvailable();
    this.assertResultRollbackCapability(boundary);
    this.assertAfterCommitCapability(boundary);
    const currentScope = this.sessions.getStore();
    if (currentScope?.owner.open) {
      this.assertRequestTransactionsAvailable();
      currentScope.owner.afterCommitEnabled ||= boundary?.requireAfterCommit === true;
      currentScope.owner.resultRollbackEnabled ||= boundary?.shouldRollback !== undefined;

      const abortContext = createRequestAbortContext(signal);
      const active = this.trackActiveRequestTransaction(abortContext.controller);

      try {
        return evaluateResult(
          currentScope.owner,
          await raceWithAbortAndDrainCallback(fn, abortContext.signal),
          boundary?.shouldRollback,
        );
      } finally {
        abortContext.cleanup();
        currentScope.activeSession.retainRequestTransaction(active);
      }
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    let untrackActiveInFinally = true;
    let committed = false;
    const confirmCommit = () => {
      committed = true;
      abortContext.cleanup();
      active.active.abort = () => {};
    };

    try {
      if (typeof this.connection.transaction === 'function') {
        let delegatedCallbackStarted = false;
        let resultRollbackEnabled = boundary?.shouldRollback !== undefined;
        const delegatedTransaction = this.runConnectionTransaction(() => {
          delegatedCallbackStarted = true;
          return raceWithAbortAndDrainCallback(fn, abortContext.signal).finally(() => {
            resultRollbackEnabled ||= this.sessions.getStore()?.owner.resultRollbackEnabled === true;
          });
        }, confirmCommit, boundary);

        try {
          return await raceWithAbortAndDrainCallback(
            () => delegatedTransaction,
            abortContext.signal,
            () => delegatedCallbackStarted,
          );
        } catch (error) {
          if (committed || (resultRollbackEnabled && delegatedCallbackStarted)) {
            return await delegatedTransaction;
          }
          throw error;
        }
      }

      const resolvedSession = await this.resolveSessionForRequest(abortContext.signal, active, () => {
        untrackActiveInFinally = false;
      });
      if (!resolvedSession) {
        if (boundary?.shouldRollback) {
          throw new TransactionRollbackCapabilityError();
        }
        return await raceWithAbortAndDrainCallback(fn, abortContext.signal);
      }

      return await this.runManualSessionTransaction(resolvedSession, () =>
        raceWithAbortAndDrainCallback(fn, abortContext.signal),
        undefined,
        confirmCommit,
        boundary,
      );
    } finally {
      abortContext.cleanup();

      if (untrackActiveInFinally) {
        this.untrackActiveRequestTransaction(active);
      }
    }
  }

  private assertResultRollbackCapability<T>(boundary?: TransactionBoundaryOptions<T>): void {
    if (!boundary?.shouldRollback) return;
    if (!this.connectionOptions.rollbackObserver) throw new TransactionRollbackCapabilityError();
    const scope = this.sessions.getStore();
    if (scope?.owner.open) {
      assertRollbackSessionCapability(scope.session);
    } else if (typeof this.connection.transaction !== 'function' && typeof this.connection.startSession !== 'function') {
      throw new TransactionRollbackCapabilityError();
    }
  }

  private assertAfterCommitCapability<T>(boundary?: TransactionBoundaryOptions<T>): void {
    if (!boundary?.requireAfterCommit) {
      return;
    }

    const scope = this.sessions.getStore();
    if (!scope?.owner.open &&
      typeof this.connection.transaction !== 'function' && typeof this.connection.startSession !== 'function') {
      throw new AfterCommitCapabilityError('Mongoose transaction requires active native after-commit support.');
    }
  }

  private assertTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(TRANSACTION_UNAVAILABLE_ERROR);
    }
  }

  private assertRequestTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(TRANSACTION_UNAVAILABLE_ERROR);
    }
  }

  private async runManualSessionTransaction<T>(
    session: MongooseSessionLike,
    fn: () => Promise<T>,
    activeCallback?: ActiveTransactionCallbackHandle,
    confirmCommit?: () => void,
    boundary?: TransactionBoundaryOptions<T>,
  ): Promise<T> {
    const activeSession = this.trackActiveSession();
    const owner: TransactionOwner = {
      callbacks: [],
      afterCommitEnabled: boundary?.requireAfterCommit === true,
      resultRollbackEnabled: boundary?.shouldRollback !== undefined,
      open: true,
    };
    const resultBoundary = new ResultBoundary(owner, boundary?.shouldRollback);

    try {
      let result: T;
      try {
        if (owner.resultRollbackEnabled) assertRollbackSessionCapability(session);
        result = await observeRollback(this.connectionOptions.rollbackObserver, () => {
          owner.observation = this.connectionOptions.rollbackObserver?.beginAttempt(session);
          return this.sessions.run({ activeSession, session, owner }, () =>
            executeSessionTransaction(session, () => this.runOwnerCallback(owner, fn, resultBoundary), owner),
          );
        });
      } catch (error) {
        owner.callbacks.length = 0;
        if (owner.resultRollbackEnabled) {
          try {
            if (typeof session.endSession === 'function') await session.endSession();
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Mongoose transaction failed and session cleanup failed.', { cause: error });
          }
        } else {
          await session.endSession();
        }
        return await resultBoundary.recover(error);
      }

      if (!owner.afterCommitEnabled) {
        await session.endSession();
        return result;
      }

      activeSession.confirmCommit();
      confirmCommit?.();
      const cleanupFailure = await Promise.resolve().then(() => session.endSession()).then(
        () => undefined,
        (reason: unknown) => ({ reason }),
      );
      await this.drainAfterCommit(owner, cleanupFailure);
      return result;
    } finally {
      owner.open = false;
      owner.callbacks.length = 0;
      activeSession.settle();
      activeCallback?.settle();
    }
  }

  private async runDirectTransaction<T>(fn: () => Promise<T>, activeCallback: ActiveTransactionCallbackHandle): Promise<T> {
    try {
      return await fn();
    } finally {
      activeCallback.settle();
    }
  }

  private async resolveSessionForRequest(
    signal: AbortSignal,
    active: ActiveRequestTransactionHandle,
    deferActiveSettlement: () => void,
  ): Promise<MongooseSessionLike | undefined> {
    const sessionPromise = this.resolveSession();

    try {
      return await raceWithAbort(() => sessionPromise, signal);
    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }

      deferActiveSettlement();
      void sessionPromise
        .then(async (session) => {
          await session?.endSession();
        })
        .catch(() => undefined)
        .finally(() => {
          this.untrackActiveRequestTransaction(active);
        });

      throw error;
    }
  }

  private async runConnectionTransaction<T>(
    fn: () => Promise<T>,
    confirmCommit?: () => void,
    boundary?: TransactionBoundaryOptions<T>,
  ): Promise<T> {
    const activeSession = this.trackActiveSession();
    let owner: TransactionOwner | undefined;
    let resultBoundary: ResultBoundary<T> | undefined;

    try {
      if (typeof this.connection.transaction !== 'function') {
        throw new Error('Mongoose connection transaction resolver initialization failed.');
      }

      let result: T;
      try {
        result = await observeRollback(this.connectionOptions.rollbackObserver, () => this.connection.transaction!((session) => {
          if (owner) {
            owner.callbacks.length = 0;
          }
          const attempt: TransactionOwner = {
            callbacks: [],
            afterCommitEnabled: boundary?.requireAfterCommit === true,
            resultRollbackEnabled: boundary?.shouldRollback !== undefined,
            open: true,
          };
          owner = attempt;
          attempt.observation = this.connectionOptions.rollbackObserver?.beginAttempt(session);
          const attemptBoundary = new ResultBoundary(attempt, boundary?.shouldRollback);
          resultBoundary = attemptBoundary;
          if (attempt.resultRollbackEnabled) assertRollbackSessionCapability(session);
          return this.sessions.run({ activeSession, session, owner: attempt }, () =>
            this.runOwnerCallback(attempt, fn, attemptBoundary),
          );
        }));
      } catch (error) {
        if (resultBoundary) return await resultBoundary.recover(error);
        throw error;
      }
      if (owner?.afterCommitEnabled) {
        activeSession.confirmCommit();
        confirmCommit?.();
        await this.drainAfterCommit(owner);
      }
      return result;
    } finally {
      if (owner) {
        owner.open = false;
        owner.callbacks.length = 0;
      }
      activeSession.settle();
    }
  }

  private async runOwnerCallback<T>(
    owner: TransactionOwner,
    fn: () => Promise<T>,
    resultBoundary: ResultBoundary<T>,
  ): Promise<T> {
    try {
      const result = resultBoundary.evaluate(await fn());
      resultBoundary.assertCommittable();
      return result;
    } catch (error) {
      owner.callbacks.length = 0;
      throw error;
    } finally {
      owner.open = false;
    }
  }

  private async drainAfterCommit(
    owner: TransactionOwner,
    cleanupFailure?: { readonly reason: unknown },
  ): Promise<void> {
    await this.sessions.exit(async () => {
      const results: PromiseSettledResult<void>[] = [];
      for (const callback of owner.callbacks) {
        results.push(await Promise.resolve().then(callback).then(
          () => ({ status: 'fulfilled', value: undefined } as const),
          (reason: unknown) => ({ status: 'rejected', reason } as const),
        ));
      }
      owner.callbacks.length = 0;
      if (cleanupFailure) {
        throw new AfterCommitCleanupError(cleanupFailure.reason, results);
      }
      if (results.some((result) => result.status === 'rejected')) {
        throw new AfterCommitError(results);
      }
    });
  }

  private trackActiveSession(): ActiveSessionScopeHandle {
    let settle!: () => void;
    const active: ActiveSessionScope = {
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    const retainedRequestTransactions = new Set<ActiveRequestTransactionHandle>();

    this.activeSessions.add(active);

    return {
      confirmCommit: () => {
        for (const handle of retainedRequestTransactions) {
          handle.active.abort = () => {};
        }
      },
      retainRequestTransaction: (handle) => {
        retainedRequestTransactions.add(handle);
      },
      settle: () => {
        for (const handle of retainedRequestTransactions) {
          this.untrackActiveRequestTransaction(handle);
        }

        retainedRequestTransactions.clear();
        this.activeSessions.delete(active);
        settle();
      },
    };
  }

  private trackActiveTransactionCallback(): ActiveTransactionCallbackHandle {
    let settle!: () => void;
    const active: ActiveTransactionCallback = {
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };

    this.activeTransactionCallbacks.add(active);

    return {
      settle: () => {
        this.activeTransactionCallbacks.delete(active);
        settle();
      },
    };
  }

  private trackActiveRequestTransaction(controller: AbortController): ActiveRequestTransactionHandle {
    return trackActiveRequestTransaction(this.activeRequestTransactions, controller);
  }

  private untrackActiveRequestTransaction(handle: ActiveRequestTransactionHandle): void {
    untrackActiveRequestTransaction(this.activeRequestTransactions, handle);
  }

  private async resolveSession(): Promise<MongooseSessionLike | undefined> {
    if (typeof this.connection.startSession !== 'function') {
      if (this.connectionOptions.strictTransactions) {
        throw new Error(TRANSACTIONS_NOT_SUPPORTED_ERROR);
      }

      return undefined;
    }

    return this.connection.startSession();
  }
}
