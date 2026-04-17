import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { BunWebSocketGatewayLifecycleService } from './bun-service.js';
import type { WebSocketModuleOptions } from './bun-types.js';

function createBunWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    BunWebSocketGatewayLifecycleService,
  ];
}

/**
 * Explicit Bun websocket module entrypoint.
 */
export class BunWebSocketModule {
  /**
   * Registers the Bun websocket lifecycle service for request-upgrade gateway hosting.
   *
   * @param options Websocket gateway runtime options for guards, limits, heartbeat, and shutdown behavior.
   * @returns A runtime module definition scoped to the Bun websocket adapter.
   */
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class BunWebSocketRuntimeModule extends BunWebSocketModule {}

    return defineModule(BunWebSocketRuntimeModule, {
      providers: createBunWebSocketProviders(options),
    });
  }
}
