import type { MaybePromise } from '@konekti/core';

export interface DrizzleDatabaseLike<TTransactionDatabase = unknown, TTransactionOptions = unknown> {
  transaction?<T>(callback: (database: TTransactionDatabase) => Promise<T>, options?: TTransactionOptions): Promise<T>;
}

export interface DrizzleModuleOptions<TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>, TTransactionDatabase = TDatabase, TTransactionOptions = unknown> {
  database: TDatabase;
  dispose?: (database: TDatabase) => MaybePromise<void>;
}

export interface DrizzleHandleProvider<TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>, TTransactionDatabase = TDatabase, TTransactionOptions = unknown> {
  current(): TDatabase | TTransactionDatabase;
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
}
