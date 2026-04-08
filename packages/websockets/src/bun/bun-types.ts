import type { WebSocketModuleOptions as SharedWebSocketModuleOptions } from '../types.js';

export type BunWebSocketMessage = string | ArrayBuffer | Uint8Array;

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

export interface BunWebSocketBinding<TData = unknown> {
  fetch(request: Request, server: BunServerLike): Response | Promise<Response> | undefined | Promise<Response | undefined>;
  websocket: BunWebSocketHandler<TData>;
}

export interface BunWebSocketBindingHost {
  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void;
}

export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: BunServerWebSocket,
  request: Request,
) => void | Promise<void>;

export interface WebSocketGatewayContext {
  request: Request;
  socket: BunServerWebSocket;
}

export type WebSocketModuleOptions = SharedWebSocketModuleOptions;
