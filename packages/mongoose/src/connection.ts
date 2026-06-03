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

type ActiveSessionScopeHandle = {
  settle(): void;
};

type MongooseRuntimeOptions = {
  strictTransactions: boolean;
};

type MongooseModelLike = Record<PropertyKey, unknown>;

type MongooseModelFactoryConnection = MongooseConnectionLike & {
  model?(name: string, ...args: unknown[]): MongooseModelLike;
};

type MongooseModelFacadeOwner = {
  currentSession(): MongooseSessionLike | undefined;
};

const MODEL_OPERATIONS_WITH_OPTIONS = new Set<PropertyKey>(['aggregate', 'bulkWrite', 'create', 'find', 'findOne']);
const ORIGINAL_MODEL = Symbol('fluo.mongoose.original-model');
const modelFacadeOwners = new WeakMap<object, Set<MongooseModelFacadeOwner>>();

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

function createAmbientSessionModelFacade<TModel extends MongooseModelLike>(model: TModel, ambient: MongooseSessionLike): TModel {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (!MODEL_OPERATIONS_WITH_OPTIONS.has(prop) || typeof value !== 'function') {
        return value;
      }

      return (...args: unknown[]) => {
        const operationArgs = [...args];
        const optionsIndex = operationArgs.length > 1 ? 1 : operationArgs.length;
        operationArgs[optionsIndex] = resolveSessionOptions(operationArgs[optionsIndex], ambient);

        return value.apply(target, operationArgs);
      };
    },
  });
}

function findAmbientSession(connection: object): MongooseSessionLike | undefined {
  const owners = modelFacadeOwners.get(connection);
  if (!owners) {
    return undefined;
  }

  for (const owner of owners) {
    const session = owner.currentSession();
    if (session) {
      return session;
    }
  }

  return undefined;
}

function installModelFacade(owner: MongooseModelFacadeOwner, connection: MongooseConnectionLike): void {
  if ((typeof connection !== 'object' || connection === null) && typeof connection !== 'function') {
    return;
  }

  const modelConnection = connection as MongooseModelFactoryConnection & {
    [ORIGINAL_MODEL]?: MongooseModelFactoryConnection['model'];
  };

  if (typeof modelConnection.model !== 'function') {
    return;
  }

  let owners = modelFacadeOwners.get(modelConnection);
  if (!owners) {
    owners = new Set<MongooseModelFacadeOwner>();
    modelFacadeOwners.set(modelConnection, owners);
  }
  owners.add(owner);

  if (modelConnection[ORIGINAL_MODEL]) {
    return;
  }

  const originalModel = modelConnection.model;
  modelConnection[ORIGINAL_MODEL] = originalModel;
  modelConnection.model = function modelWithAmbientSession(this: MongooseModelFactoryConnection, name: string, ...args: unknown[]) {
    const model = originalModel.call(this, name, ...args);
    const ambient = findAmbientSession(this);

    return ambient ? createAmbientSessionModelFacade(model, ambient) : model;
  };
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
  private readonly sessions = new AsyncLocalStorage<MongooseSessionLike>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private readonly activeSessions = new Set<ActiveSessionScope>();
  private lifecycleState: 'ready' | 'shutting-down' | 'stopped' = 'ready';

  constructor(
    private readonly connection: TConnection,
    private readonly dispose?: (connection: TConnection) => Promise<void> | void,
    private readonly connectionOptions: MongooseRuntimeOptions = { strictTransactions: false },
  ) {
    installModelFacade(this, connection);
  }

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
    return this.sessions.getStore();
  }

  /**
   * Returns a model from the root connection, injecting the ambient transaction session into conservative operations.
   *
   * @param name Model name passed to the underlying Mongoose connection.
   * @param args Additional model resolver arguments forwarded unchanged.
   * @returns The real model outside transactions, or a model facade inside an active transaction boundary.
   */
  model(name: string, ...args: unknown[]): MongooseModelLike {
    const modelConnection = this.connection as MongooseModelFactoryConnection;

    if (typeof modelConnection.model !== 'function') {
      throw new Error('Mongoose connection does not implement model().');
    }

    return modelConnection.model(name, ...args);
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
    const currentSession = this.sessions.getStore();
    if (currentSession) {
      return fn();
    }

    this.assertTransactionsAvailable();

    if (typeof this.connection.transaction === 'function') {
      return this.runConnectionTransaction(fn);
    }

    const session = await this.resolveSession();
    if (!session) {
      return fn();
    }

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
    const currentSession = this.sessions.getStore();
    if (currentSession) {
      this.assertRequestTransactionsAvailable();

      const abortContext = createRequestAbortContext(signal);
      const active = this.trackActiveRequestTransaction(abortContext.controller);

      try {
        return await raceWithAbort(fn, abortContext.signal);
      } finally {
        abortContext.cleanup();
        this.untrackActiveRequestTransaction(active);
      }
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    let untrackActiveInFinally = true;

    try {
      if (typeof this.connection.transaction === 'function') {
        return await raceWithAbort(
          () => this.runConnectionTransaction(() => raceWithAbort(fn, abortContext.signal)),
          abortContext.signal,
        );
      }

      const resolvedSession = await this.resolveSessionForRequest(abortContext.signal, active, () => {
        untrackActiveInFinally = false;
      });
      if (!resolvedSession) {
        return await raceWithAbort(fn, abortContext.signal);
      }

      return await this.runManualSessionTransaction(resolvedSession, () => raceWithAbort(fn, abortContext.signal));
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
      return await this.sessions.run(session, () => executeSessionTransaction(session, fn));
    } finally {
      try {
        await session.endSession();
      } finally {
        activeSession.settle();
      }
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

      return await this.connection.transaction((session) => this.sessions.run(session, fn));
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

    this.activeSessions.add(active);

    return {
      settle: () => {
        this.activeSessions.delete(active);
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
