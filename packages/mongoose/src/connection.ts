import { AsyncLocalStorage } from 'node:async_hooks';

import {
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@konekti/runtime';
import type { OnApplicationShutdown } from '@konekti/runtime';
import { Inject } from '@konekti/core';

import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import { createMongoosePlatformStatusSnapshot } from './status.js';
import type {
  MongooseConnectionLike,
  MongooseHandleProvider,
  MongooseSessionLike,
} from './types.js';

const TRANSACTIONS_NOT_SUPPORTED_ERROR = 'Transaction not supported: Mongoose connection does not implement startSession.';

type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
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
 * Session-aware Mongoose wrapper that integrates request scoping and shutdown handling with the Konekti runtime.
 */
@Inject([MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS])
export class MongooseConnection<TConnection extends MongooseConnectionLike = MongooseConnectionLike>
  implements MongooseHandleProvider<TConnection>, OnApplicationShutdown
{
  private readonly sessions = new AsyncLocalStorage<MongooseSessionLike>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private lifecycleState: 'ready' | 'shutting-down' | 'stopped' = 'ready';

  constructor(
    private readonly connection: TConnection,
    private readonly dispose?: (connection: TConnection) => Promise<void> | void,
    private readonly connectionOptions: MongooseRuntimeOptions = { strictTransactions: false },
  ) {}

  /** Returns the root Mongoose connection handle. */
  current(): TConnection {
    return this.connection;
  }

  /** Returns the active Mongoose session for the current async context, if one exists. */
  currentSession(): MongooseSessionLike | undefined {
    return this.sessions.getStore();
  }

  /** Aborts active request transactions, waits for settlement, then runs the optional dispose hook. */
  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));

    if (this.dispose) {
      await this.dispose(this.connection);
    }

    this.lifecycleState = 'stopped';
  }

  /** Produces the shared persistence status snapshot for platform diagnostics surfaces. */
  createPlatformStatusSnapshot() {
    return createMongoosePlatformStatusSnapshot({
      activeRequestTransactions: this.activeRequestTransactions.size,
      hasActiveSession: this.sessions.getStore() !== undefined,
      lifecycleState: this.lifecycleState,
      strictTransactions: this.connectionOptions.strictTransactions,
      supportsStartSession: typeof this.connection.startSession === 'function',
    });
  }

  /** Opens a Mongoose session transaction boundary or reuses the current one when already active. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const currentSession = this.sessions.getStore();
    if (currentSession) {
      return fn();
    }

    const session = await this.resolveSession();
    if (!session) {
      return fn();
    }

    try {
      return await this.sessions.run(session, () =>
        executeSessionTransaction(session, () => this.sessions.run(session, fn)),
      );
    } finally {
      await session.endSession();
    }
  }

  /** Opens an abort-aware request transaction boundary for the current HTTP request. */
  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const currentSession = this.sessions.getStore();
    if (currentSession) {
      if (signal) {
        return raceWithAbort(fn, signal);
      }
      return fn();
    }

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    let acquiredSession: MongooseSessionLike | undefined;

    try {
      const resolvedSession = await this.resolveSession();
      if (!resolvedSession) {
        return await raceWithAbort(fn, abortContext.signal);
      }

      acquiredSession = resolvedSession;
      return await this.sessions.run(resolvedSession, () =>
        executeSessionTransaction(resolvedSession, () =>
          this.sessions.run(resolvedSession, () => raceWithAbort(fn, abortContext.signal)),
        ),
      );
    } finally {
      abortContext.cleanup();

      try {
        await acquiredSession?.endSession();
      } finally {
        this.untrackActiveRequestTransaction(active);
      }
    }
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
