import type { RequestContext } from '../types.js';

export type RequestContextStore = {
  getStore(): RequestContext | undefined;
  run<T>(context: RequestContext, callback: () => T): T;
};
