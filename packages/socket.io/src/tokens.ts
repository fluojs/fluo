import type { Token } from '@konekti/core';
import type { Server } from 'socket.io';

import type { SocketIoRoomService } from './types.js';

/**
 * Injection token for the raw Socket.IO `Server` instance managed by {@link SocketIoModule}.
 */
export const SOCKETIO_SERVER: Token<Server> = Symbol.for('konekti.socketio.server');

/**
 * Injection token for the high-level room management service exposed by {@link SocketIoModule}.
 */
export const SOCKETIO_ROOM_SERVICE: Token<SocketIoRoomService> = Symbol.for('konekti.socketio.room-service');
