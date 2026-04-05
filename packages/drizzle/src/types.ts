import type { MaybePromise } from '@konekti/core';

type DrizzleTransactionCallback<TTransactionDatabase, TResult> = (database: TTransactionDatabase) => Promise<TResult>;

type DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions> = <T>(
  callback: DrizzleTransactionCallback<TTransactionDatabase, T>,
  options?: TTransactionOptions,
) => Promise<T>;

/**
 * Minimal Drizzle seam that exposes the optional transaction callback boundary used by the Konekti wrapper.
 */
export interface DrizzleDatabaseLike<TTransactionDatabase = unknown, TTransactionOptions = unknown> {
  transaction?: DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions>;
}

/**
 * Module options for registering a Drizzle handle and optional shutdown disposal hook.
 */
export interface DrizzleModuleOptions<TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>, TTransactionDatabase = TDatabase, TTransactionOptions = unknown> {
  database: TDatabase;
  dispose?: (database: TDatabase) => MaybePromise<void>;
  strictTransactions?: boolean;
}

/**
 * Public Drizzle wrapper contract exposed through dependency injection.
 */
export interface DrizzleHandleProvider<TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>, TTransactionDatabase = TDatabase, TTransactionOptions = unknown> {
  current(): TDatabase | TTransactionDatabase;
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T>;
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
}
