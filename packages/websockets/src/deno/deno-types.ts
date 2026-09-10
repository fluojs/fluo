import type {
  DenoServerWebSocket,
} from '@fluojs/platform-deno';

import type {
  WebSocketModuleOptions as SharedWebSocketModuleOptions,
  WebSocketUpgradeGuard as SharedWebSocketUpgradeGuard,
} from '../types.js';

/**
 * Defines the typed Deno gateway message handler signature.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = import('../types.js').TypedOnMessageHandler<
  TEvents,
  K,
  DenoServerWebSocket,
  Request
>;

/**
 * Describes the Deno request and socket context passed to gateway handlers.
 */
export interface WebSocketGatewayContext {
  request: Request;
  socket: DenoServerWebSocket;
}

/**
 * Fetch-style request guard used before Deno websocket upgrades are accepted.
 */
export type WebSocketUpgradeGuard = SharedWebSocketUpgradeGuard<Request>;

/**
 * Defines the Deno websocket module options type.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions<Request>;
