import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { NodeWebSocketGatewayLifecycleService } from './node-service.js';
import type { WebSocketModuleOptions } from './node-types.js';

export function createNodeWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    NodeWebSocketGatewayLifecycleService,
  ];
}

export class NodeWebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class NodeWebSocketRuntimeModule extends NodeWebSocketModule {}

    return defineModule(NodeWebSocketRuntimeModule, {
      providers: createNodeWebSocketProviders(options),
    });
  }
}
