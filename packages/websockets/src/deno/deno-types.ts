import type { WebSocketModuleOptions as SharedWebSocketModuleOptions } from '../types.js';

export type DenoWebSocketMessage = Blob | string;

export interface DenoServerWebSocket extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
}

export interface DenoWebSocketUpgradeResult<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  response: Response;
  socket: TSocket;
}

export interface DenoWebSocketUpgradeHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  upgrade(request: Request): DenoWebSocketUpgradeResult<TSocket>;
}

export interface DenoWebSocketBinding<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  fetch(request: Request, host: DenoWebSocketUpgradeHost<TSocket>): Response | Promise<Response>;
}

export interface DenoWebSocketBindingHost<TSocket extends DenoServerWebSocket = DenoServerWebSocket> {
  configureWebSocketBinding(binding: DenoWebSocketBinding<TSocket> | undefined): void;
}

export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: DenoServerWebSocket,
  request: Request,
) => void | Promise<void>;

export interface WebSocketGatewayContext {
  request: Request;
  socket: DenoServerWebSocket;
}

export type WebSocketModuleOptions = SharedWebSocketModuleOptions;
