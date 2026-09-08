/** Explicit mutation returned by an atomic cache reducer. */
export type CacheUpdate<T> =
  | { readonly action: 'set'; readonly value: T; readonly ttlSeconds?: number }
  | { readonly action: 'delete' };

/** Per-attempt context; reducers must be pure and may run again after a conflict. */
export interface CacheUpdateContext {
  /** One-based attempt number. */
  readonly attempt: number;
  /** Cooperative cancellation from the caller, invalidation, or shutdown. */
  readonly signal: AbortSignal;
}

/**
 * Compute a replacement or deletion from a detached snapshot.
 *
 * @param value Current value, or `undefined` for a missing/expired entry.
 * @param context Attempt number and cooperative cancellation signal.
 * @returns An explicit set or delete decision, synchronously or asynchronously.
 */
export type CacheUpdateReducer<T> = (
  value: T | undefined,
  context: CacheUpdateContext,
) => CacheUpdate<T> | Promise<CacheUpdate<T>>;

/** Optional cancellation and bounded conflict retry controls. */
export interface CacheUpdateOptions {
  /** Maximum total reducer attempts; a positive safe integer, default `16`. */
  readonly maxAttempts?: number;
  /** Cancels before commit dispatch; an already-dispatched commit cannot be undone. */
  readonly signal?: AbortSignal;
}

/** Store handoff options; the facade supplies its default TTL for missing entries. */
export interface CacheStoreUpdateOptions extends CacheUpdateOptions {
  /** Facade barrier: register invalidation synchronously, but await admission before reading or reducing. */
  readonly admission?: Promise<void>;
  /** Default TTL in seconds for a new entry; omitted means persistent. */
  readonly defaultTtlSeconds?: number;
}

/** Optional store capability; no read/modify/write fallback is inferred for legacy stores. */
export interface CacheAtomicUpdate {
  /** Memory is store-instance local; distributed stores must use a server atomic primitive. */
  readonly scope: 'local-process' | 'distributed';
  /**
   * Apply one mutation atomically against competing updates.
   *
   * @param key Cache entry key.
   * @param reducer Pure callback that can be retried.
   * @param options TTL default, cancellation, and attempt limit.
   * @returns The committed value, or `undefined` after deletion.
   */
  update<T>(key: string, reducer: CacheUpdateReducer<T>, options?: CacheStoreUpdateOptions): Promise<T | undefined>;
}

/** Stable machine-readable update failure categories. */
export type CacheUpdateErrorCode = 'unsupported' | 'invalidated' | 'closed' | 'cancelled' | 'conflict';

/** A capability, lifecycle, cancellation, or exhausted-conflict failure. */
export class CacheUpdateError extends Error {
  constructor(readonly code: CacheUpdateErrorCode, options?: ErrorOptions) {
    super(`Cache update ${code}.`, options);
    this.name = 'CacheUpdateError';
  }
}

/** Check cancellation without losing the lifecycle reason.
 * @param signal Cooperative update signal.
 */
export function checkUpdateSignal(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof CacheUpdateError
      ? signal.reason
      : new CacheUpdateError('cancelled', { cause: signal.reason });
  }
}

/**
 * Resolve an update's absolute expiry, preserving existing expiry by default.
 * @param ttlSeconds Explicit TTL in seconds, with zero meaning persistent.
 * @param previousExpiry Existing absolute expiry in milliseconds.
 * @param exists Whether the snapshot contains a live entry.
 * @param defaultTtlSeconds Default used only for a missing entry.
 * @returns Absolute millisecond expiry, or `undefined` for persistence.
 */
export function resolveUpdateExpiry(
  ttlSeconds: number | undefined,
  previousExpiry: number | undefined,
  exists: boolean,
  defaultTtlSeconds: number,
): number | undefined {
  if (ttlSeconds === undefined && exists) {
    return previousExpiry;
  }
  const ttl = ttlSeconds ?? defaultTtlSeconds;
  if (!Number.isFinite(ttl) || ttl < 0) {
    throw new RangeError('Cache update ttlSeconds must be finite and non-negative.');
  }
  return ttl === 0 ? undefined : Math.min(Number.MAX_SAFE_INTEGER, Date.now() + Math.max(1, Math.ceil(ttl * 1000)));
}

/** Store-local FIFO admission, cancellation, and reclamation for atomic updates. */
export class CacheUpdateQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly active = new Map<string, Set<AbortController>>();

  /**
   * Schedule one key without holding back unrelated keys.
   * @param key Entry key.
   * @param options Caller signal and attempt bound.
   * @param operation Store-specific atomic operation.
   * @returns The operation's result or original failure.
   */
  run<T>(
    key: string,
    options: CacheStoreUpdateOptions,
    operation: (signal: AbortSignal, maxAttempts: number) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 16;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      return Promise.reject(new RangeError('Cache update maxAttempts must be a positive safe integer.'));
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const active = this.active.get(key) ?? new Set<AbortController>();
    active.add(controller);
    this.active.set(key, active);
    const result = (this.tails.get(key) ?? Promise.resolve()).then(async () => {
      await options.admission;
      checkUpdateSignal(controller.signal);
      return operation(controller.signal, maxAttempts);
    });
    const finish = () => {
      options.signal?.removeEventListener('abort', abort);
      active.delete(controller);
      if (active.size === 0) this.active.delete(key);
      if (this.tails.get(key) === settled) this.tails.delete(key);
    };
    const settled = result.then(finish, finish);
    this.tails.set(key, settled);
    return result;
  }

  /**
   * Invalidate admitted reducers, including queued work.
   * @param key Optional key; omission invalidates every admitted update.
   * @param code Invalidation or terminal close reason.
   */
  invalidate(key?: string, code: CacheUpdateErrorCode = 'invalidated'): void {
    for (const [activeKey, controllers] of this.active) {
      if (key !== undefined && key !== activeKey) continue;
      for (const controller of controllers) controller.abort(new CacheUpdateError(code));
    }
  }
}
