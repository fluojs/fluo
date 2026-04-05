import type { MaybePromise } from '@konekti/core';

export type PrismaTransactionCallback<TTransactionClient, TResult> = (client: TTransactionClient) => Promise<TResult>;

export type InferPrismaTransactionClient<TClient> = TClient extends {
  $transaction?: <T>(
    callback: PrismaTransactionCallback<infer TTransactionClient, T>,
    options?: infer _TTransactionOptions,
  ) => Promise<T>;
}
  ? TTransactionClient
  : TClient;

export type InferPrismaTransactionOptions<TClient> = TClient extends {
  $transaction?: <T>(
    callback: PrismaTransactionCallback<infer _TTransactionClient, T>,
    options?: infer TTransactionOptions,
  ) => Promise<T>;
}
  ? TTransactionOptions
  : unknown;

export type PrismaTransactionClient<TClient> = InferPrismaTransactionClient<TClient>;

export interface PrismaClientLike<TTransactionClient = unknown, TTransactionOptions = unknown> {
  $connect?(): MaybePromise<void>;
  $disconnect?(): MaybePromise<void>;
  $transaction?<T>(callback: PrismaTransactionCallback<TTransactionClient, T>, options?: TTransactionOptions): Promise<T>;
}

export interface PrismaModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
> {
  client: TClient;
  strictTransactions?: boolean;
}

export interface PrismaHandleProvider<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
> {
  current(): TClient | TTransactionClient;
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T>;
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
}
