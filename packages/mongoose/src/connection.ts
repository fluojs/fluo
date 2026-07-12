import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject } from '@fluojs/core';
import type { OnApplicationShutdown } from '@fluojs/runtime';
import {
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@fluojs/runtime';
import { createMongoosePlatformStatusSnapshot } from './status.js';
import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import type {
  MongooseConnectionLike,
  MongooseHandleProvider,
  MongooseModelFacade,
  MongooseSessionLike,
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
  retainRequestTransaction(handle: ActiveRequestTransactionHandle): void;
  settle(): void;
};

type AmbientSessionScope = {
  activeSession: ActiveSessionScopeHandle;
  session: MongooseSessionLike;
};

type MongooseRuntimeOptions = {
  strictTransactions: boolean;
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

function resolveOptionsIndex(operation: PropertyKey, operationArgs: unknown[]): number | undefined {
  if (operation === 'create') {
    return resolveCreateOptionsIndex(operationArgs);
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

async function executeSessionTransaction<T>(session: MongooseSessionLike, fn: () => Promise<T>): Promise<T> {
  try {
    await session.startTransaction();
    const result = await fn();
    await session.commitTransaction();
    return result;
  } catch (error: unknown) {
    try {
      await session.abortTransaction();
    } catch (abortError) {
      void abortError;
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
    return this.sessions.getStore()?.session;
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
   * @returns The callback result after the session transaction finishes or the direct-execution fallback completes.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.assertTransactionsAvailable();

    const currentSession = this.sessions.getStore();
    if (currentSession) {
      return fn();
    }

    if (typeof this.connection.transaction === 'function') {
      return this.runConnectionTransaction(fn);
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
      return this.runDirectTransaction(fn, activeCallback);
    }

    activeCallback.settle();

    return this.runManualSessionTransaction(session, fn);
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
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   */
  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const currentScope = this.sessions.getStore();
    if (currentScope) {
      this.assertRequestTransactionsAvailable();

      const abortContext = createRequestAbortContext(signal);
      const active = this.trackActiveRequestTransaction(abortContext.controller);

      try {
        return await raceWithAbortAndDrainCallback(fn, abortContext.signal);
      } finally {
        abortContext.cleanup();
        currentScope.activeSession.retainRequestTransaction(active);
      }
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    let untrackActiveInFinally = true;

    try {
      if (typeof this.connection.transaction === 'function') {
        let delegatedCallbackStarted = false;
        const delegatedTransaction = this.runConnectionTransaction(() => {
          delegatedCallbackStarted = true;
          return raceWithAbortAndDrainCallback(fn, abortContext.signal);
        });

        return await raceWithAbortAndDrainCallback(
          () => delegatedTransaction,
          abortContext.signal,
          () => delegatedCallbackStarted,
        );
      }

      const resolvedSession = await this.resolveSessionForRequest(abortContext.signal, active, () => {
        untrackActiveInFinally = false;
      });
      if (!resolvedSession) {
        return await raceWithAbortAndDrainCallback(fn, abortContext.signal);
      }

      return await this.runManualSessionTransaction(resolvedSession, () =>
        raceWithAbortAndDrainCallback(fn, abortContext.signal),
      );
    } finally {
      abortContext.cleanup();

      if (untrackActiveInFinally) {
        this.untrackActiveRequestTransaction(active);
      }
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

  private async runManualSessionTransaction<T>(session: MongooseSessionLike, fn: () => Promise<T>): Promise<T> {
    const activeSession = this.trackActiveSession();

    try {
      return await this.sessions.run({ activeSession, session }, () => executeSessionTransaction(session, fn));
    } finally {
      try {
        await session.endSession();
      } finally {
        activeSession.settle();
      }
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

  private async runConnectionTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const activeSession = this.trackActiveSession();

    try {
      if (typeof this.connection.transaction !== 'function') {
        throw new Error('Mongoose connection transaction resolver initialization failed.');
      }

      return await this.connection.transaction((session) => this.sessions.run({ activeSession, session }, fn));
    } finally {
      activeSession.settle();
    }
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
