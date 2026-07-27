import { AsyncLocalStorage } from 'node:async_hooks';

import { registerImmediateAsyncLocalStorageConstructor } from './context/request-context-node-store.js';

registerImmediateAsyncLocalStorageConstructor(AsyncLocalStorage);

export * from './index.portable.js';
