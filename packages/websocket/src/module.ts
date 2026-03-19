import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { WebSocketGatewayLifecycleService } from './service.js';
import { WEBSOCKET_GATEWAY_SERVICE, WEBSOCKET_OPTIONS } from './tokens.js';
import type { WebSocketModuleOptions } from './types.js';

export function createWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS,
      useValue: options,
    },
    {
      provide: WEBSOCKET_GATEWAY_SERVICE,
      useClass: WebSocketGatewayLifecycleService,
    },
  ];
}

export function createWebSocketModule(options: WebSocketModuleOptions = {}): ModuleType {
  class WebSocketModule {}

  return defineModule(WebSocketModule, {
    providers: createWebSocketProviders(options),
  });
}
