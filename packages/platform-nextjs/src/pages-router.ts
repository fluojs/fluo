import type {
  NextApiHandler,
} from 'next';

import {
  createNextAdapter,
  type NextAdapterLoader,
  type NextAdapterOptions,
  NextHttpApplicationAdapter,
} from './adapter.js';
import { createLazyNextAdapterResolver } from './lazy-adapter.js';
import { dispatchNextPagesRequest } from './pages-bridge.js';

/** Static Pages Router config shape required for Fluo request parsing. */
export interface NextPagesRouterConfig {
  readonly api: {
    readonly bodyParser: false;
  };
}

/**
 * Create a Pages Router API handler backed by one Fluo Next adapter.
 *
 * @param loadAdapter Dynamic canonical backend module loader.
 * @returns A Next.js API handler that streams Node requests and responses.
 */
export function createNextPagesRouterHandler(
  loadAdapter: NextAdapterLoader,
): NextApiHandler<unknown> {
  const resolveAdapter = createLazyNextAdapterResolver(loadAdapter);

  return async (request, response) => {
    const adapter = await resolveAdapter();
    await dispatchNextPagesRequest(adapter, request, response);
  };
}

export {
  createNextAdapter,
  type NextAdapterLoader,
  type NextAdapterOptions,
  NextHttpApplicationAdapter,
};
