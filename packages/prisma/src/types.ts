import type { MaybePromise } from '@konekti/core';

export interface PrismaTransactionClient {
  [key: string]: unknown;
}

export type PrismaTransactionCallback<TTransactionClient, TResult> = (client: TTransactionClient) => Promise<TResult>;

export interface PrismaClientLike<TTransactionClient = PrismaTransactionClient, TTransactionOptions = unknown> {
  $connect?(): MaybePromise<void>;
  $disconnect?(): MaybePromise<void>;
  $transaction?<T>(callback: PrismaTransactionCallback<TTransactionClient, T>, options?: TTransactionOptions): Promise<T>;
}

export interface PrismaModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = TClient,
  TTransactionOptions = unknown,
> {
  client: TClient;
  strictTransactions?: boolean;
}

export interface PrismaHandleProvider<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = TClient,
  TTransactionOptions = unknown,
> {
  current(): TClient | TTransactionClient;
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T>;
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
}
