import type { Token } from '@konekti/core';

import type { WebSocketGatewayLifecycleService } from './service.js';
import type { WebSocketModuleOptions } from './types.js';

export const WEBSOCKET_GATEWAY_SERVICE: Token<WebSocketGatewayLifecycleService> = Symbol.for('konekti.websocket.gateway-service');
export const WEBSOCKET_OPTIONS: Token<WebSocketModuleOptions> = Symbol.for('konekti.websocket.options');
export const WEBSOCKET_SERVICE = WEBSOCKET_GATEWAY_SERVICE;
