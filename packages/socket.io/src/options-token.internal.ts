import type { Token } from '@fluojs/core';

import type { SocketIoModuleOptions } from './types.js';

export const SOCKETIO_OPTIONS_INTERNAL: Token<SocketIoModuleOptions> = Symbol.for('konekti.socketio.options');
