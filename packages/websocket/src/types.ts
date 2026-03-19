import type { IncomingMessage } from 'node:http';

import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { WebSocket } from 'ws';

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

export interface WebSocketGatewayContext {
  request: IncomingMessage;
  socket: WebSocket;
}
