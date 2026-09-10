import type {
  BunServerWebSocket,
} from '@fluojs/platform-bun';

import type {
  WebSocketModuleOptions as SharedWebSocketModuleOptions,
  WebSocketUpgradeGuard as SharedWebSocketUpgradeGuard,
  WebSocketUpgradeContext,
  WebSocketUpgradeRejection,
} from '../types.js';

/**
 * Defines the typed Bun gateway message handler signature.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = import('../types.js').TypedOnMessageHandler<
  TEvents,
  K,
  BunServerWebSocket,
  Request
>;

/**
 * Describes the Bun request and socket context passed to gateway handlers.
 */
export interface WebSocketGatewayContext {
  request: Request;
  socket: BunServerWebSocket;
}

/**
 * Fetch-style request guard used before Bun websocket upgrades are accepted.
 */
export type WebSocketUpgradeGuard = SharedWebSocketUpgradeGuard<Request>;

export type { WebSocketUpgradeContext, WebSocketUpgradeRejection };

/**
 * Defines the Bun websocket module options type.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions<Request>;
