import type { ServerOptions } from 'socket.io';

import type { WebSocketRoomService } from '@konekti/websockets';

/**
 * Room management contract exposed by `@konekti/socket.io` gateways.
 *
 * Extends the generic WebSocket room API with Socket.IO event emission semantics.
 */
export interface SocketIoRoomService extends WebSocketRoomService {
  /**
   * Emits an event with payload data to every socket in one room.
   *
   * @param room Room identifier that should receive the event.
   * @param event Socket.IO event name emitted to room members.
   * @param data Payload delivered with the event.
   * @param namespacePath Optional namespace path when broadcasting outside the default namespace.
   */
  broadcastToRoom(room: string, event: string, data: unknown, namespacePath?: string): void;

  /**
   * Adds one socket to a room.
   *
   * @param socketId Socket identifier to move into the room.
   * @param room Room identifier to join.
   * @param namespacePath Optional namespace path when targeting a non-default namespace.
   */
  joinRoom(socketId: string, room: string, namespacePath?: string): void;

  /**
   * Removes one socket from a room.
   *
   * @param socketId Socket identifier to remove from the room.
   * @param room Room identifier to leave.
   * @param namespacePath Optional namespace path when targeting a non-default namespace.
   */
  leaveRoom(socketId: string, room: string, namespacePath?: string): void;
}

/**
 * Options accepted by {@link SocketIoModule.forRoot} and {@link createSocketIoProviders}.
 */
export interface SocketIoModuleOptions {
  /**
   * In-memory outbound buffering controls applied before the server flushes messages to sockets.
   */
  buffer?: {
    /** Maximum number of queued outbound messages allowed per socket before overflow handling applies. */
    maxPendingMessagesPerSocket?: number;

    /** Strategy used when one socket exceeds the configured pending message cap. */
    overflowPolicy?: 'close' | 'drop-newest' | 'drop-oldest';
  };

  /** Cross-origin configuration forwarded to the underlying Socket.IO server. */
  cors?: ServerOptions['cors'];

  /** Graceful shutdown controls for draining Socket.IO resources during application close. */
  shutdown?: {
    /** Maximum time to wait for shutdown cleanup before forceful termination. */
    timeoutMs?: number;
  };

  /** Enabled Socket.IO transports such as `websocket` or `polling`. */
  transports?: ServerOptions['transports'];
}
