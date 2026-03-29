import type { ServerOptions } from 'socket.io';

import type { WebSocketRoomService } from '@konekti/websocket';

export interface SocketIoRoomService extends WebSocketRoomService {
  broadcastToRoom(room: string, event: string, data: unknown, namespacePath?: string): void;
  joinRoom(socketId: string, room: string, namespacePath?: string): void;
  leaveRoom(socketId: string, room: string, namespacePath?: string): void;
}

export interface SocketIoModuleOptions {
  buffer?: {
    maxPendingMessagesPerSocket?: number;
    overflowPolicy?: 'close' | 'drop-newest' | 'drop-oldest';
  };
  cors?: ServerOptions['cors'];
  shutdown?: {
    timeoutMs?: number;
  };
  transports?: ServerOptions['transports'];
}
