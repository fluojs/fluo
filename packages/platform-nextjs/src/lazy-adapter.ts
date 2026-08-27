import type { NextHttpApplicationAdapter } from './adapter.js';

/** Lazily imports one canonically bootstrapped Fluo Next adapter. */
export type NextAdapterLoader = () => Promise<NextHttpApplicationAdapter>;

/**
 * Create one memoized resolver around a lazily imported Fluo Next adapter.
 *
 * Repeated calls await the same import promise so concurrent first requests
 * share one canonical backend bootstrap.
 *
 * @param loadAdapter Dynamic backend module loader.
 * @returns A resolver that yields the memoized adapter promise.
 */
export function createLazyNextAdapterResolver(
  loadAdapter: NextAdapterLoader,
): () => Promise<NextHttpApplicationAdapter> {
  let adapterPromise: Promise<NextHttpApplicationAdapter> | undefined;

  return () => {
    adapterPromise ??= (async () => loadAdapter())();
    return adapterPromise;
  };
}
