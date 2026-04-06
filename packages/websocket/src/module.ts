import type { Provider } from '@konekti/di';
import type { ModuleType } from '@konekti/runtime';

import { createNodeWebSocketProviders, NodeWebSocketModule } from './node.js';
import type { WebSocketModuleOptions } from './types.js';

export function createWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return createNodeWebSocketProviders(options);
}

export class WebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    return NodeWebSocketModule.forRoot(options);
  }
}
