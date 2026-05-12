import type { RequestContext } from '../types.js';

/** Store abstraction shared by host async-context implementations and the synchronous fallback. */
export type RequestContextStore = {
  getStore(): RequestContext | undefined;
  run<T>(context: RequestContext, callback: () => T): T;
};
