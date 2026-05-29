import type { IncomingMessage } from 'node:http';

import type { MetadataPropertyKey, Token } from '@fluojs/core';
import type {
  TypedOnMessageHandler as NodeTypedOnMessageHandler,
  WebSocketGatewayContext as NodeWebSocketGatewayContext,
} from './node/node-types.js';

/**
 * Event-name-to-payload map used to type `@OnMessage(...)` handlers.
 */
export type WebSocketEventMap = Record<string, unknown>;

/**
 * Strongly typed message handler signature resolved from one {@link WebSocketEventMap} entry.
 */
export type TypedOnMessageHandler<TEvents extends WebSocketEventMap, K extends keyof TEvents> =
  NodeTypedOnMessageHandler<TEvents, K>;

/**
 * Dedicated listener configuration for runtimes that can host a standalone WebSocket server.
 */
export interface WebSocketGatewayServerBackedOptions {
  /** TCP port used by the dedicated listener. Use `0` to let the host allocate an ephemeral port. */
  port: number;
}

/**
 * Options accepted by {@link WebSocketGateway}.
 */
export interface WebSocketGatewayOptions {
  /** Request path used to match upgrade traffic for this gateway. */
  path?: string;

  /** Optional dedicated listener settings for server-backed Node.js adapters. */
  serverBacked?: WebSocketGatewayServerBackedOptions;
}

/**
 * Normalized gateway metadata stored on one decorated gateway class.
 */
export interface WebSocketGatewayMetadata {
  /** Normalized path captured from the decorator options. */
  path: string;

  /** Dedicated listener settings when the gateway opts into server-backed hosting. */
  serverBacked?: WebSocketGatewayServerBackedOptions;
}

/**
 * Lifecycle categories available to WebSocket gateway handlers.
 */
export type WebSocketGatewayHandlerType = 'connect' | 'disconnect' | 'message';

/**
 * Metadata stored for one decorated gateway method.
 */
export interface WebSocketGatewayHandlerMetadata {
  /** Optional inbound event name associated with a message handler. */
  event?: string;

  /** Handler lifecycle category recorded for the decorated method. */
  type: WebSocketGatewayHandlerType;
}

/**
 * Normalized descriptor for one discovered gateway handler.
 */
export interface WebSocketGatewayHandlerDescriptor {
  /** Optional inbound event name associated with this handler. */
  event?: string;

  /** Metadata property key used to resolve the method on the gateway instance. */
  methodKey: MetadataPropertyKey;

  /** Human-readable method name used in diagnostics and discovery output. */
  methodName: string;

  /** Handler lifecycle category. */
  type: WebSocketGatewayHandlerType;
}

/**
 * Runtime descriptor for one discovered gateway class.
 */
export interface WebSocketGatewayDescriptor {
  /** Ordered handler descriptors discovered on the gateway. */
  handlers: WebSocketGatewayHandlerDescriptor[];

  /** Connect handlers pre-indexed during discovery to avoid lifecycle hot-path filtering. */
  connectHandlers: readonly WebSocketGatewayHandlerDescriptor[];

  /** Disconnect handlers pre-indexed during discovery to avoid lifecycle hot-path filtering. */
  disconnectHandlers: readonly WebSocketGatewayHandlerDescriptor[];

  /** Event-specific message handlers pre-indexed during discovery. */
  messageHandlersByEvent: ReadonlyMap<string, readonly WebSocketGatewayHandlerDescriptor[]>;

  /** Message handlers without an event filter, invoked for every inbound message. */
  wildcardMessageHandlers: readonly WebSocketGatewayHandlerDescriptor[];

  /** Module name that contributed this gateway. */
  moduleName: string;

  /** Normalized upgrade path handled by the gateway. */
  path: string;

  /** Dedicated listener settings when the gateway opts into server-backed hosting. */
  serverBacked?: WebSocketGatewayServerBackedOptions;

  /** Class name used in diagnostics and error messages. */
  targetName: string;

  /** DI token used to resolve the gateway instance. */
  token: Token;
}

/**
 * Runtime context passed to gateway handlers on the default Node.js adapter surface.
 */
export type WebSocketGatewayContext = NodeWebSocketGatewayContext;

/**
 * Upgrade-time context shared with pre-upgrade websocket guards.
 */
export interface WebSocketUpgradeContext {
  /** Current number of open websocket connections tracked by the lifecycle service. */
  activeConnectionCount: number;

  /** Normalized gateway path targeted by the upgrade request. */
  path: string;
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
 * Hook that can allow or reject a websocket upgrade before the adapter accepts it.
 *
 * @typeParam TRequest Request shape surfaced by the selected websocket runtime.
 */
export type WebSocketUpgradeGuard<TRequest = Request> = (
  request: TRequest,
  context: WebSocketUpgradeContext,
) => Promise<boolean | WebSocketUpgradeRejection | void> | boolean | WebSocketUpgradeRejection | void;

/**
 * Room management API shared by WebSocket protocol adapters.
 */
export interface WebSocketRoomService {
  /**
   * Adds one socket to a room.
   *
   * @param socketId Socket identifier to add.
   * @param room Room identifier to join.
   */
  joinRoom(socketId: string, room: string): void;

  /**
   * Removes one socket from a room.
   *
   * @param socketId Socket identifier to remove.
   * @param room Room identifier to leave.
   */
  leaveRoom(socketId: string, room: string): void;

  /**
   * Emits one event to every socket currently in a room.
   *
   * @param room Room identifier that should receive the event.
   * @param event Event name delivered to room members.
   * @param data Payload delivered with the event.
   */
  broadcastToRoom(room: string, event: string, data: unknown): void;

  /**
   * Returns the rooms currently joined by one socket.
   *
   * @param socketId Socket identifier to inspect.
   * @returns The current room set tracked for that socket.
   */
  getRooms(socketId: string): ReadonlySet<string>;
}

/**
 * Runtime-agnostic module options shared by websocket lifecycle services.
 *
 * @typeParam TRequest Request shape received by the runtime-specific pre-upgrade guard.
 */
export interface WebSocketModuleOptions<TRequest = IncomingMessage | Request> {
  /** Limits that bound connection count and inbound payload size across runtime adapters. */
  limits?: {
    /** Maximum number of concurrently tracked websocket connections before new upgrades are rejected. */
    maxConnections?: number;

    /** Maximum inbound payload size in bytes before the connection is rejected or closed. */
    maxPayloadBytes?: number;
  };

  /** Upgrade-time controls that run before the adapter completes the websocket handshake. */
  upgrade?: {
    /** Optional guard hook that can deny anonymous or otherwise invalid upgrade requests. */
    guard?: WebSocketUpgradeGuard<TRequest>;
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
