import { AsyncLocalStorage } from 'node:async_hooks';

import { raceWithAbort } from '@konekti/runtime';
import type { OnApplicationShutdown, OnModuleInit } from '@konekti/runtime';
import { Inject } from '@konekti/core';

import { PRISMA_CLIENT } from './tokens.js';
import type { PrismaClientLike, PrismaHandleProvider } from './types.js';

@Inject([PRISMA_CLIENT])
export class PrismaService<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>
  implements PrismaHandleProvider<TClient, TTransactionClient>, OnModuleInit, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TTransactionClient>();
  private readonly activeRequestTransactions = new Set<{
    abort(reason?: unknown): void;
    settled: Promise<void>;
  }>();

  constructor(private readonly client: TClient) {}

  current(): TClient | TTransactionClient {
    return this.transactions.getStore() ?? this.client;
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
    const current = this.transactions.getStore();

    if (current) {
      return fn();
    }

    if (typeof this.client.$transaction !== 'function') {
      return fn();
    }

    return this.client.$transaction((transactionClient) => this.transactions.run(transactionClient, fn));
  }

  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const current = this.transactions.getStore();

    if (current) {
      return fn();
    }

    if (typeof this.client.$transaction !== 'function') {
      return fn();
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);

    signal?.addEventListener('abort', forwardAbort, { once: true });

    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const active = {
      abort(reason?: unknown) {
        controller.abort(reason);
      },
      settled,
    };

    this.activeRequestTransactions.add(active);

    try {
      return await this.client.$transaction((transactionClient) =>
        this.transactions.run(transactionClient, () => raceWithAbort(fn, controller.signal)),
      );
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      this.activeRequestTransactions.delete(active);
      settle();
    }
  }
}
