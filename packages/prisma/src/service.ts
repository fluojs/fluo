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
export class PrismaService<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>
  implements PrismaHandleProvider<TClient, TTransactionClient>, OnModuleInit, OnApplicationShutdown
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
    run: (callback: (transactionClient: TTransactionClient) => Promise<T>) => Promise<T>,
  ): Promise<T> {
    if (this.transactions.getStore()) {
      return fn();
    }

    if (typeof this.client.$transaction !== 'function') {
      if (this.serviceOptions.strictTransactions) {
        throw new Error('Transaction not supported: Prisma client does not implement $transaction.');
      }

      return fn();
    }

    return run((transactionClient) => this.transactions.run(transactionClient, fn));
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

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.runWithTransactionClient(fn, (callback) => this.client.$transaction!(callback));
  }

  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      return await this.runWithTransactionClient(
        () => raceWithAbort(fn, abortContext.signal),
        (callback) => this.client.$transaction!(callback),
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
