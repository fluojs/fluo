import type { Token } from '@konekti/core';
import type { Server } from 'socket.io';

import type { SocketIoLifecycleService } from './adapter.js';
import type { SocketIoModuleOptions, SocketIoRoomService } from './types.js';

export const SOCKETIO_LIFECYCLE_SERVICE: Token<SocketIoLifecycleService> = Symbol.for('konekti.socketio.lifecycle-service');
export const SOCKETIO_OPTIONS: Token<SocketIoModuleOptions> = Symbol.for('konekti.socketio.options');
export const SOCKETIO_SERVER: Token<Server> = Symbol.for('konekti.socketio.server');
export const SOCKETIO_ROOM_SERVICE: Token<SocketIoRoomService> = Symbol.for('konekti.socketio.room-service');
