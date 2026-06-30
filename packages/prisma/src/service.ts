import { Inject } from '@fluojs/core';
import type { OnApplicationShutdown, OnModuleInit } from '@fluojs/runtime';
import {
  createAbortError,
  createRequestAbortContext,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from '@fluojs/runtime';

import { PRISMA_SERVICE_BRAND } from './prisma-service-brand.js';
import { createPrismaPlatformStatusSnapshot } from './status.js';
import { PRISMA_CLIENT, PRISMA_OPTIONS } from './tokens.js';
import type {
  InferPrismaTransactionClient,
  InferPrismaTransactionOptions,
  PrismaClientLike,
  PrismaHandleProvider,
} from './types.js';

const NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR =
  'Nested Prisma transaction options are not supported because the active transaction context is reused.';
const REQUEST_TRANSACTION_UNAVAILABLE_ERROR = 'Prisma request transactions are not available during shutdown.';
const TRANSACTION_CONTEXT_UNAVAILABLE_ERROR =
  'Prisma transaction context requires AsyncLocalStorage support from the host runtime.';

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

type ActiveTransactionBoundary = {
  settled: Promise<void>;
};

type ActiveTransactionBoundaryHandle = {
  active: ActiveTransactionBoundary;
  settle(): void;
};

type TransactionAbortSignalSupport = 'unknown' | 'supported' | 'unsupported';

type TransactionContext<TTransactionClient> = {
  client: TTransactionClient;
  deferredRequestTransactionHandles?: Set<ActiveRequestTransactionHandle>;
  requestAbortSignal?: AbortSignal;
};

interface TransactionContextStore<TTransactionClient> {
  readonly kind: 'als' | 'unavailable';
  getStore(): TransactionContext<TTransactionClient> | undefined;
  run<T>(context: TransactionContext<TTransactionClient>, callback: () => T): T;
}

type AsyncContextStore<TContext> = {
  getStore(): TContext | undefined;
  run<T>(context: TContext, callback: () => T): T;
};

type AsyncLocalStorageConstructor = new <TContext>() => AsyncContextStore<TContext>;

type NodeAsyncHooksModule = {
  AsyncLocalStorage?: AsyncLocalStorageConstructor;
};

type AsyncLocalStorageResolutionHost = typeof globalThis & {
  AsyncLocalStorage?: AsyncLocalStorageConstructor;
  process?: {
    getBuiltinModule?(id: 'node:async_hooks'): NodeAsyncHooksModule;
  };
};

function createCurrentClientPrismaFacade<TTarget extends { current(): unknown }>(target: TTarget): TTarget {
  return new Proxy(target, {
    get(service, prop, receiver) {
      if (prop in service) {
        return Reflect.get(service, prop, receiver);
      }

      const currentClient = service.current() as Record<PropertyKey, unknown>;
      const value = Reflect.get(currentClient, prop, currentClient);

      return typeof value === 'function' ? value.bind(currentClient) : value;
    },
  });
}

class AsyncLocalStorageTransactionContextStore<TTransactionClient> implements TransactionContextStore<TTransactionClient> {
  readonly kind = 'als' as const;

  private readonly storage: AsyncContextStore<TransactionContext<TTransactionClient>>;

  constructor(AsyncLocalStorage: AsyncLocalStorageConstructor) {
    this.storage = new AsyncLocalStorage<TransactionContext<TTransactionClient>>();
  }

  getStore(): TransactionContext<TTransactionClient> | undefined {
    return this.storage.getStore();
  }

  run<T>(context: TransactionContext<TTransactionClient>, callback: () => T): T {
    return this.storage.run(context, callback);
  }
}

class UnavailableTransactionContextStore<TTransactionClient> implements TransactionContextStore<TTransactionClient> {
  readonly kind = 'unavailable' as const;

  getStore(): TransactionContext<TTransactionClient> | undefined {
    return undefined;
  }

  run<T>(_context: TransactionContext<TTransactionClient>, _callback: () => T): T {
    throw new Error(TRANSACTION_CONTEXT_UNAVAILABLE_ERROR);
  }
}

function resolveAsyncLocalStorageConstructor(
  host: AsyncLocalStorageResolutionHost = globalThis,
): AsyncLocalStorageConstructor | undefined {
  if (typeof host.AsyncLocalStorage === 'function') {
    return host.AsyncLocalStorage;
  }

  try {
    return host.process?.getBuiltinModule?.('node:async_hooks')?.AsyncLocalStorage;
  } catch {
    return undefined;
  }
}

function createTransactionContextStore<TTransactionClient>(): TransactionContextStore<TTransactionClient> {
  const AsyncLocalStorage = resolveAsyncLocalStorageConstructor();

  if (typeof AsyncLocalStorage === 'function') {
    return new AsyncLocalStorageTransactionContextStore<TTransactionClient>(AsyncLocalStorage);
  }

  return new UnavailableTransactionContextStore<TTransactionClient>();
}

/**
 * Prisma runtime facade that owns lifecycle hooks and transaction context access.
 *
 * @typeParam TClient Root Prisma client shape registered in the module.
 * @typeParam TTransactionClient Transaction-scoped client resolved inside `$transaction(...)` callbacks.
 * @typeParam TTransactionOptions Options forwarded to Prisma interactive transactions.
 */
@Inject(PRISMA_CLIENT, PRISMA_OPTIONS)
export class PrismaService<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
>
  implements PrismaHandleProvider<TClient, TTransactionClient, TTransactionOptions>, OnModuleInit, OnApplicationShutdown
{
  readonly [PRISMA_SERVICE_BRAND] = true;

  private readonly transactions = createTransactionContextStore<TTransactionClient>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private readonly activeTransactionBoundaries = new Set<ActiveTransactionBoundary>();
  private transactionAbortSignalSupport: TransactionAbortSignalSupport = 'unknown';
  private lifecycleState: 'created' | 'ready' | 'shutting-down' | 'stopped' = 'created';

  constructor(
    private readonly client: TClient,
    private readonly serviceOptions: PrismaServiceOptions = { strictTransactions: false },
  ) {
    this.installCurrentClientFacade();
  }

  /**
   * Creates the low-level DI facade that forwards unknown Prisma API properties to the ambient `current()` client.
   *
   * @remarks
   * This compatibility helper is used by `PrismaModule` provider wiring. Application code should prefer
   * `PrismaModule.forRoot(...)` or `PrismaModule.forRootAsync(...)`, then type injected repository handles as
   * `PrismaServiceFacade<TClient>` when direct generated Prisma delegates are needed.
   *
   * @param client Root Prisma client registered in the module.
   * @param serviceOptions Runtime transaction options consumed by the Fluo wrapper.
   * @returns A transaction-aware facade that exposes wrapper methods plus the root Prisma client surface.
   */
  static createFacade<
    TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
    TTransactionClient = InferPrismaTransactionClient<TClient>,
    TTransactionOptions = InferPrismaTransactionOptions<TClient>,
  >(
    client: TClient,
    serviceOptions: PrismaServiceOptions = { strictTransactions: false },
  ): PrismaServiceFacade<TClient, TTransactionClient, TTransactionOptions> {
    return createCurrentClientPrismaFacade(
      new PrismaService<TClient, TTransactionClient, TTransactionOptions>(client, serviceOptions),
    ) as PrismaServiceFacade<TClient, TTransactionClient, TTransactionOptions>;
  }

  private installCurrentClientFacade(): void {
    for (const prop of Reflect.ownKeys(this.client as object)) {
      if (prop in this) {
        continue;
      }

      Object.defineProperty(this, prop, {
        configurable: true,
        get: () => {
          const current = this.current() as object;
          const value = Reflect.get(current, prop);

          return typeof value === 'function' ? value.bind(current) : value;
        },
      });
    }
  }

  /**
   * Returns the active Prisma handle for the current async context.
   *
   * @example
   * ```ts
   * const user = await prisma.current().user.findUnique({ where: { id } });
   * ```
   *
   * @returns The request/transaction-scoped client when a transaction is active; otherwise the root client.
   */
  current(): TClient | TTransactionClient {
    return this.transactions.getStore()?.client ?? this.client;
  }

  private async runWithTransactionClient<T>(
    fn: () => Promise<T>,
    run: (
      callback: (transactionClient: TTransactionClient) => Promise<T>,
      options?: TTransactionOptions,
    ) => Promise<T>,
    options?: TTransactionOptions,
  ): Promise<T> {
    if (this.transactions.getStore()) {
      if (options !== undefined) {
        throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
      }

      return fn();
    }

    const activeTransaction = this.trackActiveTransactionBoundary();

    try {
      if (typeof this.client.$transaction !== 'function') {
        if (this.serviceOptions.strictTransactions) {
          throw new Error('Transaction not supported: Prisma client does not implement $transaction.');
        }

        return await fn();
      }

      this.assertTransactionContextAvailable();

      const deferredRequestTransactionHandles = new Set<ActiveRequestTransactionHandle>();

      try {
        return await run(
          (transactionClient) =>
            this.transactions.run({ client: transactionClient, deferredRequestTransactionHandles }, fn),
          options,
        );
      } finally {
        for (const handle of deferredRequestTransactionHandles) {
          this.untrackActiveRequestTransaction(handle);
        }
      }
    } finally {
      this.untrackActiveTransactionBoundary(activeTransaction);
    }
  }

  async onModuleInit(): Promise<void> {
    if (typeof this.client.$connect === 'function') {
      await this.client.$connect();
    }

    this.lifecycleState = 'ready';
  }

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));
    await Promise.allSettled(Array.from(this.activeTransactionBoundaries, (transaction) => transaction.settled));

    if (typeof this.client.$disconnect === 'function') {
      await this.client.$disconnect();
    }

    this.lifecycleState = 'stopped';
  }

  /**
   * Creates a shared platform-status snapshot for runtime/CLI/Studio health surfaces.
   *
   * @returns Platform snapshot data reflecting lifecycle state and transaction capability diagnostics.
   */
  createPlatformStatusSnapshot() {
    return createPrismaPlatformStatusSnapshot({
      activeRequestTransactions: this.activeRequestTransactions.size,
      lifecycleState: this.lifecycleState,
      strictTransactions: this.serviceOptions.strictTransactions,
      supportsConnect: typeof this.client.$connect === 'function',
      supportsDisconnect: typeof this.client.$disconnect === 'function',
      supportsTransaction: typeof this.client.$transaction === 'function',
      transactionAbortSignalSupport: this.transactionAbortSignalSupport,
      transactionContext: this.transactions.kind,
    });
  }

  /**
   * Opens a Prisma interactive transaction boundary and executes the callback in that context.
   *
   * @example
   * ```ts
   * await prisma.transaction(async () => {
   *   await prisma.current().user.create({ data });
   * });
   * ```
   *
   * @param fn Callback executed inside the transaction flow where `current()` resolves from ALS to the active transaction client,
   * or reuses the already-active context / direct-execution path when no new boundary is opened.
   * @param options Optional Prisma transaction options forwarded to `$transaction`.
   * @returns The callback result, after commit when a new interactive transaction is opened, or from direct execution when
   * nested context reuse or non-strict `$transaction` fallback applies.
   * @throws {Error} When nested transaction options are provided while already inside an active transaction.
   * @throws {Error} When strict transaction mode is enabled and the Prisma client does not implement `$transaction`.
   */
  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T> {
    return this.runWithTransactionClient(
      fn,
      (callback, transactionOptions) => this.client.$transaction!(callback, transactionOptions),
      options,
    );
  }

  /**
   * Opens an abort-aware request transaction boundary.
   *
   * @example
   * ```ts
   * await prisma.requestTransaction(async () => next.handle(), request.signal);
   * ```
   *
   * @param fn Callback executed inside the request-scoped transaction flow where `current()` resolves from ALS to the active
   * transaction client, or reuses the already-active context / direct-execution path when no new boundary is opened.
   * @param signal Optional abort signal propagated to request transaction handling.
   * @param options Optional Prisma transaction options forwarded to `$transaction`.
   * @returns The callback result, after commit when a new interactive transaction is opened, or from direct execution when
   * nested context reuse or non-strict `$transaction` fallback applies.
   * @throws {Error} When nested transaction options are provided while already inside an active transaction.
   * @throws {Error} When strict transaction mode is enabled and the Prisma client does not implement `$transaction`.
   * @throws {Error} Propagates an abort-related error when `signal` aborts before the transaction callback settles; concrete
   * error type/message depends on the runtime abort implementation.
   */
  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions): Promise<T> {
    const current = this.transactions.getStore();

    if (current) {
      if (options !== undefined) {
        throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
      }

      return this.runNestedRequestTransaction(current, fn, signal);
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);

    try {
      const result = await this.runWithRequestTransactionClient<T>(
        () => raceWithAbort(fn, abortContext.signal),
        (callback, transactionOptions) =>
          this.runRequestTransactionWithAbortSignal(callback, abortContext.signal, transactionOptions),
        options,
        abortContext.signal,
      );

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();
      this.untrackActiveRequestTransaction(active);
    }
  }

  private async runWithRequestTransactionClient<T>(
    fn: () => Promise<T>,
    run: (
      callback: (transactionClient: TTransactionClient) => Promise<T>,
      options?: TTransactionOptions,
    ) => Promise<T>,
    options: TTransactionOptions | undefined,
    signal: AbortSignal,
  ): Promise<T> {
    if (typeof this.client.$transaction !== 'function') {
      if (this.serviceOptions.strictTransactions) {
        throw new Error('Transaction not supported: Prisma client does not implement $transaction.');
      }

      return fn();
    }

    this.assertTransactionContextAvailable();

    return run(
      (transactionClient) => this.transactions.run({ client: transactionClient, requestAbortSignal: signal }, fn),
      options,
    );
  }

  private async runNestedRequestTransaction<T>(
    current: TransactionContext<TTransactionClient>,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (current.requestAbortSignal) {
      if (signal) {
        return raceWithAbort(fn, signal);
      }

      return fn();
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    current.deferredRequestTransactionHandles?.add(active);

    try {
      const result = await this.transactions.run(
        { client: current.client, requestAbortSignal: abortContext.signal },
        () => raceWithAbort(fn, abortContext.signal),
      );

      this.throwIfRequestAborted(abortContext.signal);

      return result;
    } finally {
      abortContext.cleanup();

      if (!current.deferredRequestTransactionHandles) {
        this.untrackActiveRequestTransaction(active);
      }
    }
  }

  private assertRequestTransactionsAvailable(): void {
    if (this.lifecycleState === 'shutting-down' || this.lifecycleState === 'stopped') {
      throw new Error(REQUEST_TRANSACTION_UNAVAILABLE_ERROR);
    }
  }

  private assertTransactionContextAvailable(): void {
    if (this.transactions.kind === 'unavailable') {
      throw new Error(TRANSACTION_CONTEXT_UNAVAILABLE_ERROR);
    }
  }

  private throwIfRequestAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }
  }

  private runRequestTransactionWithAbortSignal<T>(
    callback: (transactionClient: TTransactionClient) => Promise<T>,
    signal: AbortSignal,
    options?: TTransactionOptions,
  ): Promise<T> {
    if (!this.canAttemptTransactionAbortSignalOption(options)) {
      return this.client.$transaction!<T>(callback, options);
    }

    return this.runTransactionWithAbortSignalFallback(callback, signal, options);
  }

  private canAttemptTransactionAbortSignalOption(options?: TTransactionOptions): boolean {
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      return false;
    }

    if (this.transactionAbortSignalSupport === 'unsupported') {
      return false;
    }

    return true;
  }

  private async runTransactionWithAbortSignalFallback<T>(
    callback: (transactionClient: TTransactionClient) => Promise<T>,
    signal: AbortSignal,
    options?: TTransactionOptions,
  ): Promise<T> {
    let callbackInvoked = false;
    const wrappedCallback = (transactionClient: TTransactionClient) => {
      callbackInvoked = true;
      return callback(transactionClient);
    };

    try {
      const result = await this.client.$transaction!<T>(wrappedCallback, this.withTransactionAbortSignal(options, signal));
      this.transactionAbortSignalSupport = 'supported';
      return result;
    } catch (error) {
      if (callbackInvoked || !this.shouldRetryWithoutAbortSignal(error)) {
        throw error;
      }

      this.transactionAbortSignalSupport = 'unsupported';
      return this.client.$transaction!<T>(callback, options);
    }
  }

  private shouldRetryWithoutAbortSignal(error: unknown): boolean {
    if (this.transactionAbortSignalSupport === 'supported') {
      return false;
    }

    const message = this.toErrorMessage(error);

    return /signal/i.test(message) && /(argument|field|option|unknown|invalid|unexpected|unsupported|not support)/i.test(message);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private withTransactionAbortSignal(options: TTransactionOptions | undefined, signal: AbortSignal): TTransactionOptions {
    if (options === undefined) {
      return { signal } as TTransactionOptions;
    }

    return {
      ...(options as Record<string, unknown>),
      signal,
    } as TTransactionOptions;
  }

  private trackActiveRequestTransaction(controller: AbortController): ActiveRequestTransactionHandle {
    return trackActiveRequestTransaction(this.activeRequestTransactions, controller);
  }

  private untrackActiveRequestTransaction(handle: ActiveRequestTransactionHandle): void {
    untrackActiveRequestTransaction(this.activeRequestTransactions, handle);
  }

  private trackActiveTransactionBoundary(): ActiveTransactionBoundaryHandle {
    let settle!: () => void;
    const active: ActiveTransactionBoundary = {
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };

    this.activeTransactionBoundaries.add(active);

    return { active, settle };
  }

  private untrackActiveTransactionBoundary(handle: ActiveTransactionBoundaryHandle): void {
    this.activeTransactionBoundaries.delete(handle.active);
    handle.settle();
  }
}

/**
 * Injection-facing Prisma facade type that combines the Fluo wrapper methods with the registered Prisma client surface.
 *
 * @remarks
 * `PrismaModule` resolves `PrismaService` to a facade that forwards unknown properties to `current()`. Use this type in
 * repositories that call generated Prisma delegates directly, and use `PrismaService<TClient>` when only wrapper methods
 * (`current()`, `transaction(...)`, `requestTransaction(...)`, and status snapshots) are needed.
 *
 * @typeParam TClient Root Prisma client shape registered in the module.
 * @typeParam TTransactionClient Transaction-scoped client resolved inside `$transaction(...)` callbacks.
 * @typeParam TTransactionOptions Options forwarded to Prisma interactive transactions.
 */
export type PrismaServiceFacade<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
> = PrismaService<TClient, TTransactionClient, TTransactionOptions> &
  Omit<TClient, keyof PrismaService<TClient, TTransactionClient, TTransactionOptions>>;
