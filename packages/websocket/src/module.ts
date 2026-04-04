import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { WEBSOCKET_OPTIONS_INTERNAL } from './options-token.internal.js';
import { WebSocketGatewayLifecycleService } from './service.js';
import type { WebSocketModuleOptions } from './types.js';

export function createWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS_INTERNAL,
      useValue: options,
    },
    WebSocketGatewayLifecycleService,
  ];
}

export class WebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    class WebSocketRuntimeModule extends WebSocketModule {}

    return defineModule(WebSocketRuntimeModule, {
      providers: createWebSocketProviders(options),
    });
  }
}
