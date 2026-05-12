import type { RequestContext } from '../types.js';
import type { RequestContextStore } from './request-context-store.js';

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
