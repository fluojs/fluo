import type { IncomingMessage } from 'node:http';

import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { WebSocket } from 'ws';

export type WebSocketEventMap = Record<string, unknown>;

export type TypedOnMessageHandler<TEvents extends WebSocketEventMap, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: WebSocket,
  request: IncomingMessage,
) => void | Promise<void>;

export interface WebSocketGatewayOptions<TEvents extends WebSocketEventMap = WebSocketEventMap> {
  path?: string;
}

export interface WebSocketGatewayMetadata {
  path: string;
}

export type WebSocketGatewayHandlerType = 'connect' | 'disconnect' | 'message';

export interface WebSocketGatewayHandlerMetadata {
  event?: string;
  type: WebSocketGatewayHandlerType;
}

export interface WebSocketGatewayHandlerDescriptor {
  event?: string;
  methodKey: MetadataPropertyKey;
  methodName: string;
  type: WebSocketGatewayHandlerType;
}

export interface WebSocketGatewayDescriptor {
  handlers: WebSocketGatewayHandlerDescriptor[];
  moduleName: string;
  path: string;
  targetName: string;
  token: Token;
}

export interface WebSocketGatewayContext {
  request: IncomingMessage;
  socket: WebSocket;
}

export interface WebSocketRoomService {
  joinRoom(socketId: string, room: string): void;
  leaveRoom(socketId: string, room: string): void;
  broadcastToRoom(room: string, event: string, data: unknown): void;
  getRooms(socketId: string): ReadonlySet<string>;
}

export interface WebSocketModuleOptions {
  heartbeat?: {
    enabled?: boolean;
    intervalMs?: number;
    timeoutMs?: number;
  };
  shutdown?: {
    timeoutMs?: number;
  };
}
