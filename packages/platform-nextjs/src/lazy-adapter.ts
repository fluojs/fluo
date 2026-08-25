import type { NextHttpApplicationAdapter } from './adapter.js';

/** Lazily imports one canonically bootstrapped Fluo Next adapter. */
export type NextAdapterLoader = () => Promise<NextHttpApplicationAdapter>;

export function createLazyNextAdapterResolver(
  loadAdapter: NextAdapterLoader,
): () => Promise<NextHttpApplicationAdapter> {
  let adapterPromise: Promise<NextHttpApplicationAdapter> | undefined;

  return () => {
    adapterPromise ??= (async () => loadAdapter())();
    return adapterPromise;
  };
}
