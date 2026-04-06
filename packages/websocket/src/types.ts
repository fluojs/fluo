import type { MetadataPropertyKey, Token } from '@konekti/core';
import type {
  TypedOnMessageHandler as NodeTypedOnMessageHandler,
  WebSocketGatewayContext as NodeWebSocketGatewayContext,
  WebSocketModuleOptions as NodeWebSocketModuleOptions,
} from './node-types.js';

export type WebSocketEventMap = Record<string, unknown>;

export type TypedOnMessageHandler<TEvents extends WebSocketEventMap, K extends keyof TEvents> =
  NodeTypedOnMessageHandler<TEvents, K>;

export interface WebSocketGatewayOptions {
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

export type WebSocketGatewayContext = NodeWebSocketGatewayContext;

export interface WebSocketRoomService {
  joinRoom(socketId: string, room: string): void;
  leaveRoom(socketId: string, room: string): void;
  broadcastToRoom(room: string, event: string, data: unknown): void;
  getRooms(socketId: string): ReadonlySet<string>;
}

export type WebSocketModuleOptions = NodeWebSocketModuleOptions;
