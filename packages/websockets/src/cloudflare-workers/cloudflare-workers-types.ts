import type { WebSocketModuleOptions as SharedWebSocketModuleOptions } from '../types.js';

export type CloudflareWorkerWebSocketMessage = ArrayBuffer | ArrayBufferView | Blob | string;

export interface CloudflareWorkerWebSocket
  extends Pick<WebSocket, 'addEventListener' | 'close' | 'removeEventListener' | 'send'> {
  readonly readyState: number;
  accept(): void;
}

export interface CloudflareWorkerWebSocketPair {
  0: CloudflareWorkerWebSocket;
  1: CloudflareWorkerWebSocket;
}

export interface CloudflareWorkerWebSocketUpgradeResult {
  response: Response;
  serverSocket: CloudflareWorkerWebSocket;
}

export interface CloudflareWorkerWebSocketUpgradeHost {
  upgrade(request: Request): CloudflareWorkerWebSocketUpgradeResult;
}

export interface CloudflareWorkerWebSocketBinding {
  fetch(request: Request, host: CloudflareWorkerWebSocketUpgradeHost): Response | Promise<Response>;
}

export interface CloudflareWorkerWebSocketBindingHost {
  configureWebSocketBinding(binding: CloudflareWorkerWebSocketBinding | undefined): void;
}

export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: CloudflareWorkerWebSocket,
  request: Request,
) => void | Promise<void>;

export interface WebSocketGatewayContext {
  request: Request;
  socket: CloudflareWorkerWebSocket;
}

export type WebSocketModuleOptions = SharedWebSocketModuleOptions;
