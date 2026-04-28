import type { WebSocketModuleOptions as SharedWebSocketModuleOptions } from '../types.js';

/**
 * Defines the deno web socket message type.
 */
export type DenoWebSocketMessage = Blob | string;

/**
 * Describes the deno server web socket contract.
 */
export interface DenoServerWebSocket extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
}

/**
 * Describes the deno web socket upgrade result contract.
 */
export interface DenoWebSocketUpgradeResult<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  response: Response;
  socket: TSocket;
}

/**
 * Describes the deno web socket upgrade host contract.
 */
export interface DenoWebSocketUpgradeHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  upgrade(request: Request): DenoWebSocketUpgradeResult<TSocket>;
}

/**
 * Describes the deno web socket binding contract.
 */
export interface DenoWebSocketBinding<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  fetch(request: Request, host: DenoWebSocketUpgradeHost<TSocket>): Response | Promise<Response>;
}

/**
 * Describes the deno web socket binding host contract.
 */
export interface DenoWebSocketBindingHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  configureWebSocketBinding(binding: DenoWebSocketBinding<TSocket> | undefined): void;
}

/**
 * Defines the typed on message handler type.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: DenoServerWebSocket,
  request: Request,
) => void | Promise<void>;

/**
 * Describes the web socket gateway context contract.
 */
export interface WebSocketGatewayContext {
  request: Request;
  socket: DenoServerWebSocket;
}

/**
 * Defines the web socket module options type.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions;
