import type { IncomingMessage } from 'node:http';

import type { ServerOptions, Socket } from 'socket.io';

import type { WebSocketRoomService } from '@fluojs/websockets';

/**
 * Room management contract exposed by `@fluojs/socket.io` gateways.
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
 * Rejection details returned by Socket.IO auth guards when a connection or message should be blocked.
 */
export interface SocketIoGuardRejection {
  /** Optional structured payload forwarded to `connect_error` or acknowledgement callbacks. */
  data?: unknown;

  /** When `true`, rejected message events disconnect the current socket after the rejection is reported. */
  disconnect?: boolean;

  /** Caller-visible reason reported for the rejected operation. */
  message?: string;
}

/**
 * Runtime context passed to Socket.IO connection guards before gateway connect handlers execute.
 */
export interface SocketIoConnectionGuardContext {
  /** Count of active Socket.IO connections already accepted by this lifecycle service. */
  activeConnectionCount: number;

  /** Namespace path currently being connected, normalized to the Socket.IO gateway path contract. */
  namespacePath: string;

  /** Raw HTTP handshake request exposed by the selected Socket.IO runtime. */
  request: IncomingMessage;

  /** Socket.IO socket instance under evaluation. */
  socket: Socket;
}

/**
 * Guard function that can reject one Socket.IO namespace connection before gateway lifecycle hooks run.
 */
export type SocketIoConnectionGuard = (
  context: SocketIoConnectionGuardContext,
) =>
  | Promise<boolean | SocketIoGuardRejection | void>
  | boolean
  | SocketIoGuardRejection
  | void;

/**
 * Runtime context passed to Socket.IO message guards before matched gateway message handlers execute.
 */
export interface SocketIoMessageGuardContext {
  /** Number of active Socket.IO connections already accepted by this lifecycle service. */
  activeConnectionCount: number;

  /** Socket.IO event name currently being dispatched. */
  event: string;

  /** Namespace path that received the event. */
  namespacePath: string;

  /** Event payload extracted from the Socket.IO argument list. */
  payload: unknown;

  /** Raw HTTP handshake request associated with the current socket. */
  request: IncomingMessage;

  /** Socket.IO socket instance emitting the event. */
  socket: Socket;
}

/**
 * Guard function that can reject one inbound Socket.IO event before gateway message handlers execute.
 */
export type SocketIoMessageGuard = (
  context: SocketIoMessageGuardContext,
) =>
  | Promise<boolean | SocketIoGuardRejection | void>
  | boolean
  | SocketIoGuardRejection
  | void;

/**
 * Options accepted by {@link SocketIoModule.forRoot} and {@link createSocketIoProviders}.
 */
export interface SocketIoModuleOptions {
  /**
   * Optional auth guards evaluated before namespace connections and inbound message handlers proceed.
   */
  auth?: {
    /** Rejects namespace connections before `@OnConnect()` handlers execute. */
    connection?: SocketIoConnectionGuard;

    /** Rejects inbound events before matching `@OnMessage(...)` handlers execute. */
    message?: SocketIoMessageGuard;
  };

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

  /**
   * Engine-level bounds forwarded to Socket.IO's underlying Engine.IO server.
   */
  engine?: {
    /** Maximum accepted inbound payload size in bytes before Engine.IO rejects the request or frame. */
    maxHttpBufferSize?: number;
  };

  /** Graceful shutdown controls for draining Socket.IO resources during application close. */
  shutdown?: {
    /** Maximum time to wait for shutdown cleanup before forceful termination. */
    timeoutMs?: number;
  };

  /** Enabled Socket.IO transports such as `websocket` or `polling`. */
  transports?: ServerOptions['transports'];
}
