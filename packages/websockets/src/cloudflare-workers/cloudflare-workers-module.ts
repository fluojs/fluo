import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { CloudflareWorkersWebSocketGatewayLifecycleService } from './cloudflare-workers-service.js';
import type { WebSocketModuleOptions } from './cloudflare-workers-types.js';

function createCloudflareWorkersWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    CloudflareWorkersWebSocketGatewayLifecycleService,
  ];
}

/**
 * Explicit Cloudflare Workers websocket module entrypoint.
 */
export class CloudflareWorkersWebSocketModule {
  /**
   * Registers the Cloudflare Workers websocket lifecycle service for request-upgrade gateway hosting.
   *
   * @param options Websocket gateway runtime options for guards, limits, heartbeat, and shutdown behavior.
   * @returns A runtime module definition scoped to the Cloudflare Workers websocket adapter.
   */
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class CloudflareWorkersWebSocketRuntimeModule extends CloudflareWorkersWebSocketModule {}

    return defineModule(CloudflareWorkersWebSocketRuntimeModule, {
      providers: createCloudflareWorkersWebSocketProviders(options),
    });
  }
}
