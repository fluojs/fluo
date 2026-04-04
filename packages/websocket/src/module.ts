import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { WebSocketGatewayLifecycleService } from './service.js';
import { WEBSOCKET_OPTIONS } from './tokens.js';
import type { WebSocketModuleOptions } from './types.js';

export function createWebSocketProviders(options: WebSocketModuleOptions = {}): Provider[] {
  return [
    {
      provide: WEBSOCKET_OPTIONS,
      useValue: options,
    },
    WebSocketGatewayLifecycleService,
  ];
}

export class WebSocketModule {
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    return defineModule(WebSocketModule, {
      providers: createWebSocketProviders(options),
    });
  }
}
