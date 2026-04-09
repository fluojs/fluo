import type { MaybePromise } from '@konekti/core';

type PrismaTransactionCallback<TTransactionClient, TResult> = (client: TTransactionClient) => Promise<TResult>;

/**
 * Infers the transaction-scoped Prisma client type exposed inside `$transaction(...)` callbacks.
 *
 * @typeParam TClient Root Prisma client shape registered with Konekti.
 */
export type InferPrismaTransactionClient<TClient> = TClient extends {
  $transaction?: <T>(
    callback: PrismaTransactionCallback<infer TTransactionClient, T>,
    options?: infer _TTransactionOptions,
  ) => Promise<T>;
}
  ? TTransactionClient
  : TClient;

/**
 * Infers the optional Prisma transaction options object accepted by the registered client.
 *
 * @typeParam TClient Root Prisma client shape registered with Konekti.
 */
export type InferPrismaTransactionOptions<TClient> = TClient extends {
  $transaction?: <T>(
    callback: PrismaTransactionCallback<infer _TTransactionClient, T>,
    options?: infer TTransactionOptions,
  ) => Promise<T>;
}
  ? TTransactionOptions
  : unknown;

/**
 * Alias for the transaction-scoped Prisma client type derived from a root client.
 *
 * @typeParam TClient Root Prisma client shape registered with Konekti.
 */
export type PrismaTransactionClient<TClient> = InferPrismaTransactionClient<TClient>;

/**
 * Minimal Prisma client seam required by the Konekti runtime wrapper.
 *
 * @typeParam TTransactionClient Client shape passed into interactive transaction callbacks.
 * @typeParam TTransactionOptions Options shape forwarded to `$transaction(...)`.
 */
export interface PrismaClientLike<TTransactionClient = unknown, TTransactionOptions = unknown> {
  $connect?(): MaybePromise<void>;
  $disconnect?(): MaybePromise<void>;
  $transaction?<T>(callback: PrismaTransactionCallback<TTransactionClient, T>, options?: TTransactionOptions): Promise<T>;
}

/**
 * Configures how `PrismaModule` wires a Prisma client into the Konekti lifecycle.
 *
 * @typeParam TClient Root Prisma client shape registered in the module.
 * @typeParam TTransactionClient Transaction-scoped client resolved by `current()` inside transaction boundaries.
 * @typeParam TTransactionOptions Options forwarded to Prisma interactive transactions.
 */
export interface PrismaModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
> {
  /** Root Prisma client shared outside ambient transaction scopes. */
  client: TClient;
  /**
   * Throws when transaction helpers are used against a client that does not implement `$transaction(...)`.
   *
   * @remarks
   * Leave this disabled when you want `transaction()` / `requestTransaction()` to fall back to direct execution.
   */
  strictTransactions?: boolean;
}

/**
 * Public transaction-aware Prisma contract exposed through dependency injection.
 *
 * @typeParam TClient Root Prisma client shape registered in the module.
 * @typeParam TTransactionClient Transaction-scoped client resolved inside transaction callbacks.
 * @typeParam TTransactionOptions Options forwarded to Prisma interactive transactions.
 */
export interface PrismaHandleProvider<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
> {
  /** Returns the ambient transaction client when present, or the root Prisma client otherwise. */
  current(): TClient | TTransactionClient;
  /**
   * Opens an abort-aware request transaction boundary around `fn`.
   *
   * @param fn Callback executed within the request transaction scope.
   * @param signal Optional abort signal linked to the request lifecycle.
   * @param options Optional Prisma transaction options forwarded to `$transaction(...)`.
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   */
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T>;
  /**
   * Opens an interactive transaction boundary around `fn`.
   *
   * @param fn Callback executed within the transaction scope.
   * @param options Optional Prisma transaction options forwarded to `$transaction(...)`.
   * @returns The callback result after the transaction finishes or the direct-execution fallback completes.
   */
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
}
