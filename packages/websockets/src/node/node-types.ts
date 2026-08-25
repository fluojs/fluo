import type { IncomingMessage } from 'node:http';

import type { WebSocket } from 'ws';

import type {
  WebSocketModuleOptions as SharedWebSocketModuleOptions,
  WebSocketUpgradeGuard as SharedWebSocketUpgradeGuard,
  WebSocketUpgradeContext,
  WebSocketUpgradeRejection,
} from '../types.js';

/**
 * Strongly typed message handler signature for the Node websocket runtime.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = import('../types.js').TypedOnMessageHandler<
  TEvents,
  K,
  WebSocket,
  IncomingMessage
>;

/**
 * Request and socket context passed to Node websocket gateway handlers.
 */
export interface WebSocketGatewayContext {
  request: IncomingMessage;
  socket: WebSocket;
}

export type { WebSocketUpgradeContext, WebSocketUpgradeRejection };

/**
 * Hook that can allow or reject a websocket upgrade before the adapter accepts it.
 */
export type WebSocketUpgradeGuard = SharedWebSocketUpgradeGuard<IncomingMessage>;

/**
 * Runtime options shared by the Node websocket lifecycle service.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions<IncomingMessage>;
