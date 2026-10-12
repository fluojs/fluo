import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { DenoWebSocketGatewayLifecycleService } from './deno-service.js';
import type { WebSocketModuleOptions } from './deno-types.js';

/**
 * Explicit Deno websocket module entrypoint.
 *
 * @deprecated Deno support ends at the next major. See
 * https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-from-deno.md
 */
export class DenoWebSocketModule {
  /**
   * Registers the Deno websocket lifecycle service for request-upgrade gateway hosting.
   *
   * @param options Websocket gateway runtime options for guards, limits, heartbeat, and shutdown behavior.
   * @returns A runtime module definition scoped to the Deno websocket adapter.
   * @deprecated Migrate to the Node, Bun, or Workers module before the next major.
   */
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class DenoWebSocketRuntimeModule extends DenoWebSocketModule {}

    return defineModule(DenoWebSocketRuntimeModule, {
      providers: [
        {
          provide: WEBSOCKET_OPTIONS_INTERNAL,
          useValue: options,
        },
        DenoWebSocketGatewayLifecycleService,
      ],
    });
  }
}
