import type {
  CloudflareWorkerWebSocket,
} from '@fluojs/platform-cloudflare-workers';

import type {
  WebSocketModuleOptions as SharedWebSocketModuleOptions,
  WebSocketUpgradeGuard as SharedWebSocketUpgradeGuard,
  WebSocketUpgradeContext,
  WebSocketUpgradeRejection,
} from '../types.js';

/**
 * Defines the typed Cloudflare Workers gateway message handler signature.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = import('../types.js').TypedOnMessageHandler<
  TEvents,
  K,
  CloudflareWorkerWebSocket,
  Request
>;

/**
 * Describes the Cloudflare Workers request and socket context passed to gateway handlers.
 */
export interface WebSocketGatewayContext {
  request: Request;
  socket: CloudflareWorkerWebSocket;
}

/**
 * Fetch-style request guard used before Cloudflare Workers websocket upgrades are accepted.
 */
export type WebSocketUpgradeGuard = SharedWebSocketUpgradeGuard<Request>;

export type { WebSocketUpgradeContext, WebSocketUpgradeRejection };

/**
 * Defines the Cloudflare Workers websocket module options type.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions<Request>;
