import { AsyncLocalStorage } from 'node:async_hooks';

import {
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@konekti/runtime';
import type { OnApplicationShutdown, OnModuleInit } from '@konekti/runtime';
import { Inject } from '@konekti/core';

import { createPrismaPlatformStatusSnapshot } from './status.js';
import { PRISMA_CLIENT, PRISMA_OPTIONS } from './tokens.js';
import type { PrismaClientLike, PrismaHandleProvider } from './types.js';

const NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR =
  'Nested Prisma transaction options are not supported because the active transaction context is reused.';

interface PrismaServiceOptions {
  strictTransactions: boolean;
}

type ActiveRequestTransaction = {
  abort(reason?: unknown): void;
  settled: Promise<void>;
};

type ActiveRequestTransactionHandle = {
  active: ActiveRequestTransaction;
  settle(): void;
};

type TransactionAbortSignalSupport = 'unknown' | 'supported' | 'unsupported';

/**
 * Prisma runtime facade that owns lifecycle hooks and transaction context access.
 */
@Inject([PRISMA_CLIENT, PRISMA_OPTIONS])
export class PrismaService<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = TClient,
  TTransactionOptions = unknown,
>
  implements PrismaHandleProvider<TClient, TTransactionClient, TTransactionOptions>, OnModuleInit, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TTransactionClient>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private transactionAbortSignalSupport: TransactionAbortSignalSupport = 'unknown';
  private lifecycleState: 'created' | 'ready' | 'shutting-down' | 'stopped' = 'created';

  constructor(
    private readonly client: TClient,
    private readonly serviceOptions: PrismaServiceOptions = { strictTransactions: false },
  ) {}

  /**
   * Returns the active Prisma handle for the current async context.
   *
   * @returns The request/transaction-scoped client when a transaction is active; otherwise the root client.
   */
  current(): TClient | TTransactionClient {
    return this.transactions.getStore() ?? this.client;
  }

  private async runWithTransactionClient<T>(
    fn: () => Promise<T>,
    run: (
      callback: (transactionClient: TTransactionClient) => Promise<T>,
      options?: TTransactionOptions,
    ) => Promise<T>,
    options?: TTransactionOptions,
  ): Promise<T> {
    if (this.transactions.getStore()) {
      if (options !== undefined) {
        throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
      }

      return fn();
    }

    if (typeof this.client.$transaction !== 'function') {
      if (this.serviceOptions.strictTransactions) {
        throw new Error('Transaction not supported: Prisma client does not implement $transaction.');
      }

      return fn();
    }

    return run((transactionClient) => this.transactions.run(transactionClient, fn), options);
  }

  async onModuleInit(): Promise<void> {
    if (typeof this.client.$connect === 'function') {
      await this.client.$connect();
    }

    this.lifecycleState = 'ready';
  }

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));

    if (typeof this.client.$disconnect === 'function') {
      await this.client.$disconnect();
    }

    this.lifecycleState = 'stopped';
  }

  /**
   * Creates a shared platform-status snapshot for runtime/CLI/Studio health surfaces.
   *
   * @returns Platform snapshot data reflecting lifecycle state and transaction capability diagnostics.
   */
  createPlatformStatusSnapshot() {
    return createPrismaPlatformStatusSnapshot({
      activeRequestTransactions: this.activeRequestTransactions.size,
      lifecycleState: this.lifecycleState,
      strictTransactions: this.serviceOptions.strictTransactions,
      supportsConnect: typeof this.client.$connect === 'function',
      supportsDisconnect: typeof this.client.$disconnect === 'function',
      supportsTransaction: typeof this.client.$transaction === 'function',
      transactionAbortSignalSupport: this.transactionAbortSignalSupport,
    });
  }

  /**
   * Opens a Prisma interactive transaction boundary and executes the callback in that context.
   *
   * @param fn Callback executed with `current()` bound to the active transaction client.
   * @param options Optional Prisma transaction options forwarded to `$transaction`.
   * @returns The callback result after transaction commit.
   * @throws {Error} When nested transaction options are provided while already inside an active transaction.
   * @throws {Error} When strict transaction mode is enabled and the Prisma client does not implement `$transaction`.
   */
  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T> {
    return this.runWithTransactionClient(
      fn,
      (callback, transactionOptions) => this.client.$transaction!(callback, transactionOptions),
      options,
    );
  }

  /**
   * Opens an abort-aware request transaction boundary.
   *
   * @param fn Callback executed within the request transaction boundary.
   * @param signal Optional abort signal propagated to request transaction handling.
   * @param options Optional Prisma transaction options forwarded to `$transaction`.
   * @returns The callback result after transaction commit.
   * @throws {Error} When nested transaction options are provided while already inside an active transaction.
   * @throws {Error} When strict transaction mode is enabled and the Prisma client does not implement `$transaction`.
   * @throws {Error} An `AbortError` when `signal` aborts before the transaction callback settles.
   */
  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T> {
    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    const transactionPromise = this.runWithTransactionClient<T>(
      () => raceWithAbort(fn, abortContext.signal),
      (callback, transactionOptions) =>
        this.runRequestTransactionWithAbortSignal(callback, abortContext.signal, transactionOptions),
      options,
    );

    try {
      return await transactionPromise;
    } finally {
      abortContext.cleanup();
      this.untrackActiveRequestTransaction(active);
    }
  }

  private runRequestTransactionWithAbortSignal<T>(
    callback: (transactionClient: TTransactionClient) => Promise<T>,
    signal: AbortSignal,
    options?: TTransactionOptions,
  ): Promise<T> {
    if (!this.canAttemptTransactionAbortSignalOption(options)) {
      return this.client.$transaction!<T>(callback, options);
    }

    return this.runTransactionWithAbortSignalFallback(callback, signal, options);
  }

  private canAttemptTransactionAbortSignalOption(options?: TTransactionOptions): boolean {
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      return false;
    }

    if (this.transactionAbortSignalSupport === 'unsupported') {
      return false;
    }

    return true;
  }

  private async runTransactionWithAbortSignalFallback<T>(
    callback: (transactionClient: TTransactionClient) => Promise<T>,
    signal: AbortSignal,
    options?: TTransactionOptions,
  ): Promise<T> {
    let callbackInvoked = false;
    const wrappedCallback = (transactionClient: TTransactionClient) => {
      callbackInvoked = true;
      return callback(transactionClient);
    };

    try {
      const result = await this.client.$transaction!<T>(wrappedCallback, this.withTransactionAbortSignal(options, signal));
      this.transactionAbortSignalSupport = 'supported';
      return result;
    } catch (error) {
      if (callbackInvoked || !this.shouldRetryWithoutAbortSignal(error)) {
        throw error;
      }

      this.transactionAbortSignalSupport = 'unsupported';
      return this.client.$transaction!<T>(callback, options);
    }
  }

  private shouldRetryWithoutAbortSignal(error: unknown): boolean {
    if (this.transactionAbortSignalSupport === 'supported') {
      return false;
    }

    const message = this.toErrorMessage(error);

    return /signal/i.test(message) && /(argument|field|option|unknown|invalid|unexpected|unsupported|not support)/i.test(message);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private withTransactionAbortSignal(options: TTransactionOptions | undefined, signal: AbortSignal): TTransactionOptions {
    if (options === undefined) {
      return { signal } as TTransactionOptions;
    }

    return {
      ...(options as Record<string, unknown>),
      signal,
    } as TTransactionOptions;
  }

  private trackActiveRequestTransaction(controller: AbortController): ActiveRequestTransactionHandle {
    return trackActiveRequestTransaction(this.activeRequestTransactions, controller);
  }

  private untrackActiveRequestTransaction(handle: ActiveRequestTransactionHandle): void {
    untrackActiveRequestTransaction(this.activeRequestTransactions, handle);
  }
}
