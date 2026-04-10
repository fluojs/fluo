import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import { DenoWebSocketGatewayLifecycleService } from './deno-service.js';
import type { WebSocketModuleOptions } from './deno-types.js';

export function createDenoWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    DenoWebSocketGatewayLifecycleService,
  ];
}

export class DenoWebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class DenoWebSocketRuntimeModule extends DenoWebSocketModule {}

    return defineModule(DenoWebSocketRuntimeModule, {
      providers: createDenoWebSocketProviders(options),
    });
  }
}
