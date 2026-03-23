import { AsyncLocalStorage } from 'node:async_hooks';

import {
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@konekti/runtime';
import type { OnApplicationShutdown, OnModuleInit } from '@konekti/runtime';
import { Inject } from '@konekti/core';

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

  constructor(
    private readonly client: TClient,
    private readonly serviceOptions: PrismaServiceOptions = { strictTransactions: false },
  ) {}

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
  }

  async onApplicationShutdown(): Promise<void> {
    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));

    if (typeof this.client.$disconnect === 'function') {
      await this.client.$disconnect();
    }
  }

  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T> {
    return this.runWithTransactionClient(
      fn,
      (callback, transactionOptions) => this.client.$transaction!(callback, transactionOptions),
      options,
    );
  }

  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T> {
    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      return await this.runWithTransactionClient(
        () => raceWithAbort(fn, abortContext.signal),
        (callback, transactionOptions) => this.client.$transaction!(callback, transactionOptions),
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
}
