import type { Token } from '@fluojs/core';

import type { WebSocketModuleOptions } from './types.js';

export const WEBSOCKET_OPTIONS_INTERNAL: Token<WebSocketModuleOptions> = Symbol.for('konekti.websocket.options');
