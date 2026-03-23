import type { ServerOptions } from 'socket.io';

import type { WebSocketRoomService } from '@konekti/websocket';

export interface SocketIoRoomService extends WebSocketRoomService {
}

export interface SocketIoModuleOptions {
  cors?: ServerOptions['cors'];
  shutdown?: {
    timeoutMs?: number;
  };
  transports?: ServerOptions['transports'];
}
