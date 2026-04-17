import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { NodeWebSocketGatewayLifecycleService } from './node-service.js';
import type { WebSocketModuleOptions } from './node-types.js';

function createNodeWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    NodeWebSocketGatewayLifecycleService,
  ];
}

/**
 * Explicit Node.js websocket module entrypoint.
 */
export class NodeWebSocketModule {
  /**
   * Registers the Node.js websocket lifecycle service for gateway discovery and upgrades.
   *
   * @param options Websocket gateway runtime options for guards, limits, heartbeat, and shutdown behavior.
   * @returns A runtime module definition scoped to the Node.js websocket adapter.
   */
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class NodeWebSocketRuntimeModule extends NodeWebSocketModule {}

    return defineModule(NodeWebSocketRuntimeModule, {
      providers: createNodeWebSocketProviders(options),
    });
  }
}
