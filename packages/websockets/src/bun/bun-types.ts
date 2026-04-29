import type { WebSocketModuleOptions as SharedWebSocketModuleOptions } from '../types.js';

/**
 * Defines the bun web socket message type.
 */
export type BunWebSocketMessage = string | ArrayBuffer | Uint8Array;

/**
 * Describes the bun server web socket contract.
 */
export interface BunServerWebSocket<TData = unknown> {
  readonly data: TData;
  readonly readyState: number;
  readonly remoteAddress: string;
  readonly subscriptions: string[];
  close(code?: number, reason?: string): void;
  cork(callback: (socket: BunServerWebSocket<TData>) => void): void;
  isSubscribed(topic: string): boolean;
  publish(topic: string, message: BunWebSocketMessage): void;
  send(message: BunWebSocketMessage, compress?: boolean): number;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

/**
 * Describes the bun server like contract.
 */
export interface BunServerLike {
  fetch?(request: Request): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  hostname?: string;
  port?: number;
  stop(closeActiveConnections?: boolean): void;
  upgrade<TData = unknown>(
    request: Request,
    options?: {
      data?: TData;
      headers?: HeadersInit;
    },
  ): boolean;
  url?: URL;
}

/**
 * Describes the bun web socket handler contract.
 */
export interface BunWebSocketHandler<TData = unknown> {
  backpressureLimit?: number;
  close?(socket: BunServerWebSocket<TData>, code: number, reason: string): void | Promise<void>;
  closeOnBackpressureLimit?: boolean;
  data?: TData;
  drain?(socket: BunServerWebSocket<TData>): void | Promise<void>;
  error?(socket: BunServerWebSocket<TData>, error: Error): void | Promise<void>;
  idleTimeout?: number;
  maxPayloadLength?: number;
  message?(socket: BunServerWebSocket<TData>, message: BunWebSocketMessage): void | Promise<void>;
  open?(socket: BunServerWebSocket<TData>): void | Promise<void>;
  perMessageDeflate?:
    | boolean
    | {
        compress?: boolean | '128KB' | '16KB' | '256KB' | '32KB' | '3KB' | '4KB' | '64KB' | '8KB' | 'dedicated' | 'disable' | 'shared';
        decompress?: boolean | '128KB' | '16KB' | '256KB' | '32KB' | '3KB' | '4KB' | '64KB' | '8KB' | 'dedicated' | 'disable' | 'shared';
      };
  publishToSelf?: boolean;
  sendPings?: boolean;
}

/**
 * Describes the bun web socket binding contract.
 */
export interface BunWebSocketBinding<TData = unknown> {
  fetch(request: Request, server: BunServerLike): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  websocket: BunWebSocketHandler<TData>;
}

/**
 * Describes the bun web socket binding host contract.
 */
export interface BunWebSocketBindingHost {
  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void;
}

/**
 * Defines the typed on message handler type.
 */
export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: BunServerWebSocket,
  request: Request,
) => void | Promise<void>;

/**
 * Describes the web socket gateway context contract.
 */
export interface WebSocketGatewayContext {
  request: Request;
  socket: BunServerWebSocket;
}

/**
 * Defines the web socket module options type.
 */
export type WebSocketModuleOptions = SharedWebSocketModuleOptions;
