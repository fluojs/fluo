import type { WebSocketModuleOptions as SharedWebSocketModuleOptions } from '../types.js';

/**
 * Defines the cloudflare worker web socket message type.
 */
export type CloudflareWorkerWebSocketMessage = ArrayBuffer | ArrayBufferView | Blob | string;

/**
 * Describes the cloudflare worker web socket contract.
 */
export interface CloudflareWorkerWebSocket
  extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
  accept(): void;
}

/**
 * Describes the cloudflare worker web socket pair contract.
 */
export interface CloudflareWorkerWebSocketPair {
  0: CloudflareWorkerWebSocket;
  1: CloudflareWorkerWebSocket;
}

/**
 * Describes the cloudflare worker web socket upgrade result contract.
 */
export interface CloudflareWorkerWebSocketUpgradeResult {
  response: Response;
  serverSocket: CloudflareWorkerWebSocket;
}

/**
 * Describes the cloudflare worker web socket upgrade host contract.
 */
export interface CloudflareWorkerWebSocketUpgradeHost {
  upgrade(request: Request): CloudflareWorkerWebSocketUpgradeResult;
}

/**
 * Describes the cloudflare worker web socket binding contract.
 */
export interface CloudflareWorkerWebSocketBinding {
  fetch(request: Request, host: CloudflareWorkerWebSocketUpgradeHost): Response | Promise<Response>;
}

/**
 * Describes the cloudflare worker web socket binding host contract.
 */
export interface CloudflareWorkerWebSocketBindingHost {
  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void;
}

/**
 * Defines the typed on message handler type.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: CloudflareWorkerWebSocket,
  request: Request,
) => void | Promise<void>;

/**
 * Describes the web socket gateway context contract.
 */
export interface WebSocketGatewayContext {
  request: Request;
  socket: CloudflareWorkerWebSocket;
}

/**
 * Defines the web socket module options type.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions;
