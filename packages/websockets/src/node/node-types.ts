import type { IncomingMessage } from 'node:http';

import type { WebSocket } from 'ws';

/**
 * Strongly typed message handler signature for the Node websocket runtime.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: WebSocket,
  request: IncomingMessage,
) => void | Promise<void>;

/**
 * Request and socket context passed to Node websocket gateway handlers.
 */
export interface WebSocketGatewayContext {
  request: IncomingMessage;
  socket: WebSocket;
}

/**
 * Structured rejection returned by a pre-upgrade websocket guard.
 */
export interface WebSocketUpgradeRejection {
  /** Optional plaintext response body sent with the rejection. */
  body?: string;

  /** Optional HTTP headers added to the rejection response. */
  headers?: Record<string, string>;

  /** HTTP status code returned instead of completing the websocket upgrade. */
  status: number;
}

/**
 * Runtime context passed to pre-upgrade websocket guards.
 */
export interface WebSocketUpgradeContext {
  /** Current number of open websocket connections tracked by the lifecycle service. */
  activeConnectionCount: number;

  /** Normalized gateway path targeted by the upgrade request. */
  path: string;
}

/**
 * Hook that can allow or reject a websocket upgrade before the adapter accepts it.
 */
export type WebSocketUpgradeGuard = (
  request: IncomingMessage | Request,
  context: WebSocketUpgradeContext,
) =>
  | Promise<boolean | WebSocketUpgradeRejection | void>
  | boolean
  | WebSocketUpgradeRejection
  | void;

/**
 * Runtime options shared by the Node websocket lifecycle service.
 */
export interface WebSocketModuleOptions {
  /**
   * Limits that bound connection count and inbound payload size across runtime adapters.
   */
  limits?: {
    /**
     * Maximum number of concurrently tracked websocket connections before new upgrades are rejected.
     */
    maxConnections?: number;

    /**
     * Maximum inbound payload size in bytes before the connection is rejected or closed.
     */
    maxPayloadBytes?: number;
  };

  /**
   * Upgrade-time controls that run before the adapter completes the websocket handshake.
   */
  upgrade?: {
    /**
     * Optional guard hook that can deny anonymous or otherwise invalid upgrade requests.
     */
    guard?: WebSocketUpgradeGuard;
  };

  backpressure?: {
    maxBufferedAmountBytes?: number;
    policy?: 'close' | 'drop';
  };
  buffer?: {
    maxPendingMessagesPerSocket?: number;
    overflowPolicy?: 'close' | 'drop-newest' | 'drop-oldest';
  };
  heartbeat?: {
    enabled?: boolean;
    intervalMs?: number;
    timeoutMs?: number;
  };
  shutdown?: {
    timeoutMs?: number;
  };
}
