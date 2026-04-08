import type { Token } from '@konekti/core';
import type { Server } from 'socket.io';

import type { SocketIoRoomService } from './types.js';

export const SOCKETIO_SERVER: Token<Server> = Symbol.for('konekti.socketio.server');
export const SOCKETIO_ROOM_SERVICE: Token<SocketIoRoomService> = Symbol.for('konekti.socketio.room-service');
