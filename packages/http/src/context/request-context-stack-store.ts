import type { RequestContext } from '../types.js';
import type { RequestContextStore } from './request-context-store.js';

/**
 * Creates the synchronous fallback request-context store used when no async-context primitive exists.
 *
 * @returns A stack-backed request-context store scoped to synchronous callback frames.
 */
export function createStackRequestContextStore(): RequestContextStore {
  const stack: RequestContext[] = [];

  return {
    getStore() {
      return stack.at(-1);
    },
    run<T>(context: RequestContext, callback: () => T): T {
      stack.push(context);

      try {
        return callback();
      } catch (error) {
        throw error;
      } finally {
        removeStackContext(stack, context);
      }
    },
  };
}

function removeStackContext(stack: RequestContext[], context: RequestContext): void {
  const index = stack.lastIndexOf(context);

  if (index >= 0) {
    stack.splice(index, 1);
  }
}
