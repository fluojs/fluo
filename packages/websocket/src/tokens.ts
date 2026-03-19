import type { Token } from '@konekti/core';

import type { WebSocketGatewayLifecycleService } from './service.js';

export const WEBSOCKET_GATEWAY_SERVICE: Token<WebSocketGatewayLifecycleService> = Symbol.for('konekti.websocket.gateway-service');
