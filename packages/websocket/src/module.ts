import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { WebSocketGatewayLifecycleService } from './service.js';
import { WEBSOCKET_GATEWAY_SERVICE } from './tokens.js';

export function createWebSocketProviders(): Provider[] {
  return [
    {
      provide: WEBSOCKET_GATEWAY_SERVICE,
      useClass: WebSocketGatewayLifecycleService,
    },
  ];
}

export function createWebSocketModule(): ModuleType {
  class WebSocketModule {}

  return defineModule(WebSocketModule, {
    providers: createWebSocketProviders(),
  });
}
