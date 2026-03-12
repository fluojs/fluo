import { AsyncLocalStorage } from 'node:async_hooks';

import type { OnApplicationShutdown, OnModuleInit } from '@konekti-internal/module';
import { Inject } from '@konekti/core';

import { PRISMA_CLIENT } from './tokens';
import type { PrismaClientLike, PrismaHandleProvider } from './types';

@Inject([PRISMA_CLIENT])
export class PrismaService<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>
  implements PrismaHandleProvider<TClient, TTransactionClient>, OnModuleInit, OnApplicationShutdown
{
  private readonly transactions = new AsyncLocalStorage<TTransactionClient>();

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
}
