import type { MaybePromise } from '@fluojs/core';

type DrizzleTransactionCallback<TTransactionDatabase, TResult> = (database: TTransactionDatabase) => Promise<TResult>;

type DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions> = <T>(
  callback: DrizzleTransactionCallback<TTransactionDatabase, T>,
  options?: TTransactionOptions,
) => Promise<T>;

/**
 * Minimal Drizzle seam that exposes the optional transaction callback boundary used by the Konekti wrapper.
 *
 * @typeParam TTransactionDatabase Transaction handle shape passed into `database.transaction(...)` callbacks.
 * @typeParam TTransactionOptions Options forwarded to the underlying Drizzle transaction runner.
 */
export interface DrizzleDatabaseLike<TTransactionDatabase = unknown, TTransactionOptions = unknown> {
  transaction?: DrizzleTransactionRunner<TTransactionDatabase, TTransactionOptions>;
}

/**
 * Module options for registering a Drizzle handle and optional shutdown disposal hook.
 *
 * @typeParam TDatabase Root Drizzle database handle registered in the module.
 * @typeParam TTransactionDatabase Transaction-scoped database handle resolved by `current()`.
 * @typeParam TTransactionOptions Options forwarded to `database.transaction(...)`.
 */
export interface DrizzleModuleOptions<TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>, TTransactionDatabase = TDatabase, TTransactionOptions = unknown> {
  /** Root Drizzle database handle shared outside ambient transaction scopes. */
  database: TDatabase;
  /** Optional shutdown hook used to close pools or driver resources during application shutdown. */
  dispose?: (database: TDatabase) => MaybePromise<void>;
  /**
   * Throws when transaction helpers are used against a database that does not expose `transaction(...)`.
   *
   * @remarks
   * Leave this disabled when transaction helpers should fall back to direct execution.
   */
  strictTransactions?: boolean;
}

/**
 * Public Drizzle wrapper contract exposed through dependency injection.
 *
 * @typeParam TDatabase Root Drizzle database handle registered in the module.
 * @typeParam TTransactionDatabase Transaction-scoped database handle resolved inside transaction boundaries.
 * @typeParam TTransactionOptions Options forwarded to `database.transaction(...)`.
 */
export interface DrizzleHandleProvider<TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>, TTransactionDatabase = TDatabase, TTransactionOptions = unknown> {
  /** Returns the ambient transaction database when present, or the root Drizzle handle otherwise. */
  current(): TDatabase | TTransactionDatabase;
  /**
   * Opens an abort-aware request transaction boundary around `fn`.
   *
   * @param fn Callback executed within the request transaction scope.
   * @param signal Optional abort signal linked to the request lifecycle.
   * @param options Optional transaction options forwarded to `database.transaction(...)`.
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   */
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T>;
  /**
   * Opens a Drizzle transaction boundary around `fn`.
   *
   * @param fn Callback executed within the transaction scope.
   * @param options Optional transaction options forwarded to `database.transaction(...)`.
   * @returns The callback result after the transaction finishes or the direct-execution fallback completes.
   */
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
}
