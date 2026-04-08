import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { CloudflareWorkersWebSocketGatewayLifecycleService } from './cloudflare-workers-service.js';
import type { WebSocketModuleOptions } from './cloudflare-workers-types.js';

export function createCloudflareWorkersWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    CloudflareWorkersWebSocketGatewayLifecycleService,
  ];
}

export class CloudflareWorkersWebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class CloudflareWorkersWebSocketRuntimeModule extends CloudflareWorkersWebSocketModule {}

    return defineModule(CloudflareWorkersWebSocketRuntimeModule, {
      providers: createCloudflareWorkersWebSocketProviders(options),
    });
  }
}
