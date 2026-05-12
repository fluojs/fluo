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

import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import { createMongoosePlatformStatusSnapshot } from './status.js';
import type {
  MongooseConnectionLike,
  MongooseHandleProvider,
  MongooseSessionLike,
} from './types.js';

const TRANSACTIONS_NOT_SUPPORTED_ERROR = 'Transaction not supported: Mongoose connection does not implement startSession.';
const TRANSACTIONS_UNAVAILABLE_ERROR = 'Mongoose transactions are not available during shutdown.';
const REQUEST_TRANSACTIONS_UNAVAILABLE_ERROR = 'Mongoose request transactions are not available during shutdown.';

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
    return this.sessions.getStore();
  }

  /** Aborts active request transactions, waits for settlement, then runs the optional dispose hook. */
  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    await this.drainActiveShutdownWork();

    if (this.dispose) {
      await this.dispose(this.connection);
    }

    this.lifecycleState = 'stopped';
  }

  private async drainActiveShutdownWork(): Promise<void> {
    do {
      for (const transaction of this.activeRequestTransactions) {
        transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
      }

      await Promise.allSettled([
        ...Array.from(this.activeRequestTransactions, (transaction) => transaction.settled),
        ...Array.from(this.activeSessions, (session) => session.settled),
      ]);
    } while (this.activeRequestTransactions.size > 0 || this.activeSessions.size > 0);
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

      if (signal) {
        return raceWithAbort(fn, signal);
      }
      return fn();
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      if (typeof this.connection.transaction === 'function') {
        const transaction = () => this.runConnectionTransaction(() => raceWithAbort(fn, abortContext.signal));
        const result = signal ? await raceWithAbort<T>(transaction, abortContext.signal) : await transaction();

        this.throwIfRequestAborted(abortContext.signal);

        return result;
      }

      const resolvedSession = await this.resolveRequestSession(abortContext.signal, signal !== undefined);
      if (!resolvedSession) {
        const result = await raceWithAbort(fn, abortContext.signal);

        this.throwIfRequestAborted(abortContext.signal);

        return result;
      }

      const result = await this.runManualSessionTransaction<T>(resolvedSession, () => raceWithAbort(fn, abortContext.signal));

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();

      this.untrackActiveRequestTransaction(active);
    }
  }

  private assertTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(TRANSACTIONS_UNAVAILABLE_ERROR);
    }
  }

  private assertRequestTransactionsAvailable(): void {
    if (this.lifecycleState !== 'ready') {
      throw new Error(REQUEST_TRANSACTIONS_UNAVAILABLE_ERROR);
    }
  }

  private throwIfRequestAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw createAbortError(signal.reason);
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

  private async resolveRequestSession(
    signal: AbortSignal,
    raceSessionAcquisition: boolean,
  ): Promise<MongooseSessionLike | undefined> {
    const sessionPromise = this.resolveSession();

    if (!raceSessionAcquisition) {
      return sessionPromise;
    }

    try {
      return await raceWithAbort(() => sessionPromise, signal);
    } catch (error) {
      if (signal.aborted) {
        this.trackPendingRequestSessionCleanup(sessionPromise);
      }

      throw error;
    }
  }

  private trackPendingRequestSessionCleanup(sessionPromise: Promise<MongooseSessionLike | undefined>): void {
    const activeSession = this.trackActiveSession();

    void sessionPromise
      .then((session) => session?.endSession())
      .catch((cleanupError: unknown) => {
        void cleanupError;
      })
      .finally(() => {
        activeSession.settle();
      });
  }
}
