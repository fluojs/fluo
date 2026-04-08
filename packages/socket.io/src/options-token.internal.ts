import type { Token } from '@konekti/core';

import type { SocketIoModuleOptions } from './types.js';

export const SOCKETIO_OPTIONS_INTERNAL: Token<SocketIoModuleOptions> = Symbol.for('konekti.socketio.options');
