import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { BunWebSocketGatewayLifecycleService } from './bun-service.js';
import type { WebSocketModuleOptions } from './bun-types.js';

export function createBunWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    BunWebSocketGatewayLifecycleService,
  ];
}

export class BunWebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class BunWebSocketRuntimeModule extends BunWebSocketModule {}

    return defineModule(BunWebSocketRuntimeModule, {
      providers: createBunWebSocketProviders(options),
    });
  }
}
