import type { MaybePromise } from '@konekti/core';

export interface PrismaTransactionClient {
  [key: string]: unknown;
}

export type PrismaTransactionCallback<TTransactionClient, TResult> = (client: TTransactionClient) => Promise<TResult>;

export interface PrismaClientLike<TTransactionClient = PrismaTransactionClient> {
  $connect?(): MaybePromise<void>;
  $disconnect?(): MaybePromise<void>;
  $transaction?<T>(callback: PrismaTransactionCallback<TTransactionClient, T>): Promise<T>;
}

export interface PrismaModuleOptions<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient> {
  client: TClient;
  strictTransactions?: boolean;
}

export interface PrismaHandleProvider<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient> {
  current(): TClient | TTransactionClient;
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
