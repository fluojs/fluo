import type { MetadataPropertyKey, Token } from '@fluojs/core';
import type {
  TypedOnMessageHandler as NodeTypedOnMessageHandler,
  WebSocketGatewayContext as NodeWebSocketGatewayContext,
  WebSocketModuleOptions as NodeWebSocketModuleOptions,
  WebSocketUpgradeContext as NodeWebSocketUpgradeContext,
  WebSocketUpgradeGuard as NodeWebSocketUpgradeGuard,
  WebSocketUpgradeRejection as NodeWebSocketUpgradeRejection,
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
  /** TCP port used by the dedicated listener. */
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
export type WebSocketUpgradeContext = NodeWebSocketUpgradeContext;

/**
 * Structured rejection returned by a pre-upgrade websocket guard.
 */
export type WebSocketUpgradeRejection = NodeWebSocketUpgradeRejection;

/**
 * Hook that can allow or reject a websocket upgrade before the adapter accepts it.
 */
export type WebSocketUpgradeGuard = NodeWebSocketUpgradeGuard;

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
 * Runtime-agnostic module options that currently mirror the Node.js adapter options.
 */
export type WebSocketModuleOptions = NodeWebSocketModuleOptions;
