import { Inject } from '@fluojs/core';
import {
  type AfterCommitCallback,
  AfterCommitCapabilityError,
  AfterCommitError,
  type TransactionBoundaryOptions,
} from './after-commit.js';
import {
  type ActiveRequestTransaction,
  type ActiveRequestTransactionHandle,
  createAbortError,
  createRequestAbortContext,
  type OnApplicationShutdown,
  type OnModuleInit,
  raceWithAbort,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from './integration.js';

import { markPrismaServiceHandle } from './prisma-service-brand.js';
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
const TRANSACTION_BOUNDARY_UNAVAILABLE_ERROR = 'Prisma transaction boundaries are not available during shutdown.';
const TRANSACTION_CONTEXT_UNAVAILABLE_ERROR =
  'Prisma transaction context requires AsyncLocalStorage support from the host runtime.';

interface PrismaServiceOptions {
  strictTransactions: boolean;
}

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
  owner: { closed: boolean; hooks: AfterCommitCallback[] };
  deferredRequestTransactionHandles?: Set<ActiveRequestTransactionHandle>;
  requestAbortSignal?: AbortSignal;
};

interface TransactionContextStore<TTransactionClient> {
  readonly kind: 'als' | 'unavailable';
  getStore(): TransactionContext<TTransactionClient> | undefined;
  run<T>(context: TransactionContext<TTransactionClient> | undefined, callback: () => T): T;
}

type AsyncContextStore<TContext> = {
  getStore(): TContext | undefined;
  run<T>(context: TContext | undefined, callback: () => T): T;
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
  markPrismaServiceHandle(target);

  return markPrismaServiceHandle(new Proxy(target, {
    get(service, prop, receiver) {
      if (prop in service) {
        return Reflect.get(service, prop, receiver);
      }

      const currentClient = service.current() as Record<PropertyKey, unknown>;
      const value = Reflect.get(currentClient, prop, currentClient);

      return typeof value === 'function' ? value.bind(currentClient) : value;
    },
  }));
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

  run<T>(context: TransactionContext<TTransactionClient> | undefined, callback: () => T): T {
    return this.storage.run(context, callback);
  }
}

class UnavailableTransactionContextStore<TTransactionClient> implements TransactionContextStore<TTransactionClient> {
  readonly kind = 'unavailable' as const;

  getStore(): TransactionContext<TTransactionClient> | undefined {
    return undefined;
  }

  run<T>(_context: TransactionContext<TTransactionClient> | undefined, _callback: () => T): T {
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
  private readonly transactions = createTransactionContextStore<TTransactionClient>();
  private readonly activeRequestTransactions = new Set<ActiveRequestTransaction>();
  private readonly activeTransactionBoundaries = new Set<ActiveTransactionBoundary>();
  private connectTransition?: Promise<void>;
  private shutdownTransition?: Promise<void>;
  private transactionAbortSignalSupport: TransactionAbortSignalSupport = 'unknown';
  private lifecycleState: 'created' | 'ready' | 'shutting-down' | 'stopped' = 'created';

  constructor(
    private readonly client: TClient,
    private readonly serviceOptions: PrismaServiceOptions = { strictTransactions: false },
  ) {
    markPrismaServiceHandle(this);
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
    return this.activeContext()?.client ?? this.client;
  }

  /**
   * Registers work to invoke after the active outer native transaction commits.
   *
   * @param callback Synchronous or asynchronous hook, awaited in FIFO order outside the ended transaction context.
   * @throws {AfterCommitCapabilityError} When the client has no native commit boundary.
   * @throws {Error} When called outside an active transaction callback or from an ended scope.
   */
  afterCommit(callback: AfterCommitCallback): void {
    this.assertAfterCommitCapability();
    const context = this.activeContext();
    if (!context) {
      throw new Error('afterCommit registration requires an active transaction callback.');
    }
    context.owner.hooks.push(callback);
  }

  private activeContext(): TransactionContext<TTransactionClient> | undefined {
    const context = this.transactions.getStore();
    return context?.owner.closed ? undefined : context;
  }

  private assertAfterCommitCapability(): void {
    if (typeof this.client.$transaction !== 'function' || this.transactions.kind === 'unavailable') {
      throw new AfterCommitCapabilityError();
    }
  }

  private async drainAfterCommit(owner: TransactionContext<TTransactionClient>['owner']): Promise<void> {
    const hooks = owner.hooks.splice(0);
    await this.transactions.run(undefined, async () => {
      const results: PromiseSettledResult<void>[] = [];
      for (const hook of hooks) {
        try {
          await hook();
          results.push({ status: 'fulfilled', value: undefined });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }
      if (results.some((result) => result.status === 'rejected')) {
        throw new AfterCommitError(results);
      }
    });
  }

  private async runWithTransactionClient<T>(
    fn: () => Promise<T>,
    run: (
      callback: (transactionClient: TTransactionClient) => Promise<T>,
      options?: TTransactionOptions,
    ) => Promise<T>,
    options?: TTransactionOptions,
    boundary?: TransactionBoundaryOptions,
  ): Promise<T> {
    if (boundary?.requireAfterCommit) {
      this.assertAfterCommitCapability();
    }
    if (this.activeContext()) {
      if (options !== undefined) {
        throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
      }

      return fn();
    }

    this.assertTransactionBoundariesAvailable();

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
      const owner: TransactionContext<TTransactionClient>['owner'] = { closed: false, hooks: [] };

      try {
        const result = await run(
          (transactionClient) =>
            this.transactions.run({ client: transactionClient, deferredRequestTransactionHandles, owner }, async () => {
              try {
                return await fn();
              } finally {
                owner.closed = true;
              }
            }),
          options,
        );
        await this.drainAfterCommit(owner);
        return result;
      } finally {
        owner.closed = true;
        owner.hooks.length = 0;
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
      this.connectTransition = Promise.resolve(this.client.$connect());
      await this.connectTransition;
    }

    if (this.lifecycleState === 'created') {
      this.lifecycleState = 'ready';
    }
  }

  onApplicationShutdown(): Promise<void> {
    if (this.lifecycleState === 'stopped') {
      return Promise.resolve();
    }

    if (this.shutdownTransition) {
      return this.shutdownTransition;
    }

    const shutdownTransition = this.completeApplicationShutdown();
    this.shutdownTransition = shutdownTransition;
    void shutdownTransition.then(undefined, () => {
      if (this.shutdownTransition === shutdownTransition) {
        this.shutdownTransition = undefined;
      }
    });

    return shutdownTransition;
  }

  private async completeApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'shutting-down';

    for (const transaction of this.activeRequestTransactions) {
      transaction.abort(new Error('Application shutdown interrupted an open request transaction.'));
    }

    await Promise.allSettled(Array.from(this.activeRequestTransactions, (transaction) => transaction.settled));
    await Promise.allSettled(Array.from(this.activeTransactionBoundaries, (transaction) => transaction.settled));

    if (this.connectTransition) {
      await Promise.allSettled([this.connectTransition]);
    }

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
      activeTransactionBoundaries: this.activeTransactionBoundaries.size,
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
   * @param boundary Optional requirement for native afterCommit capability, checked before `fn`.
   * @returns The callback result, after commit when a new interactive transaction is opened, or from direct execution when
   * nested context reuse or non-strict `$transaction` fallback applies.
   * @throws {Error} When nested transaction options are provided while already inside an active transaction.
   * @throws {Error} When strict transaction mode is enabled and the Prisma client does not implement `$transaction`.
   */
  async transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions, boundary?: TransactionBoundaryOptions): Promise<T> {
    return this.runWithTransactionClient(
      fn,
      (callback, transactionOptions) => this.client.$transaction!(callback, transactionOptions),
      options,
      boundary,
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
   * @param boundary Optional requirement for native afterCommit capability, checked before `fn`.
   * @returns The callback result, after commit when a new interactive transaction is opened, or from direct execution when
   * nested context reuse or non-strict `$transaction` fallback applies.
   * @throws {Error} When nested transaction options are provided while already inside an active transaction.
   * @throws {Error} When strict transaction mode is enabled and the Prisma client does not implement `$transaction`.
   * @throws {Error} Propagates an abort-related error when `signal` aborts before the transaction callback settles; concrete
   * error type/message depends on the runtime abort implementation.
   */
  async requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, options?: TTransactionOptions, boundary?: TransactionBoundaryOptions): Promise<T> {
    if (boundary?.requireAfterCommit) {
      this.assertAfterCommitCapability();
    }
    const current = this.activeContext();

    if (current) {
      if (options !== undefined) {
        throw new Error(NESTED_TRANSACTION_OPTIONS_NOT_SUPPORTED_ERROR);
      }

      return this.runNestedRequestTransaction(current, fn, signal);
    }

    this.assertRequestTransactionsAvailable();

    const abortContext = createRequestAbortContext(signal);
    const active = this.trackActiveRequestTransaction(abortContext.controller);
    const owner: TransactionContext<TTransactionClient>['owner'] = { closed: false, hooks: [] };

    try {
      const result = await this.runWithRequestTransactionClient<T>(
        () => raceWithAbort(fn, abortContext.signal),
        (callback, transactionOptions) =>
          this.runRequestTransactionWithAbortSignal(callback, abortContext.signal, transactionOptions),
        options,
        abortContext.signal,
        owner,
      );

      // Opt-in hooks observe a confirmed commit, not cancellation arriving during post-commit work.
      if (!boundary?.requireAfterCommit && owner.hooks.length === 0) {
        this.throwIfRequestAborted(abortContext.signal);
      }
      if (typeof this.client.$transaction === 'function') {
        await this.drainAfterCommit(owner);
      }

      return result;
    } finally {
      owner.closed = true;
      owner.hooks.length = 0;
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
    owner: TransactionContext<TTransactionClient>['owner'],
  ): Promise<T> {
    if (typeof this.client.$transaction !== 'function') {
      if (this.serviceOptions.strictTransactions) {
        throw new Error('Transaction not supported: Prisma client does not implement $transaction.');
      }

      return fn();
    }

    this.assertTransactionContextAvailable();

    return run(
      (transactionClient) => this.transactions.run({ client: transactionClient, requestAbortSignal: signal, owner }, async () => {
        try {
          return await fn();
        } finally {
          owner.closed = true;
        }
      }),
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
        { ...current, requestAbortSignal: abortContext.signal },
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

  private assertTransactionBoundariesAvailable(): void {
    if (this.lifecycleState === 'shutting-down' || this.lifecycleState === 'stopped') {
      throw new Error(TRANSACTION_BOUNDARY_UNAVAILABLE_ERROR);
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
