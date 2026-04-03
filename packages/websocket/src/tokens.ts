import type { Token } from '@konekti/core';

import type { WebSocketModuleOptions } from './types.js';

export const WEBSOCKET_OPTIONS: Token<WebSocketModuleOptions> = Symbol.for('konekti.websocket.options');
