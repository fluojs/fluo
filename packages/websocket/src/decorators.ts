import { metadataSymbol } from '@konekti/core';

import { webSocketGatewayMetadataSymbol, webSocketHandlerMetadataSymbol } from './metadata.js';
import type { WebSocketEventMap, WebSocketGatewayHandlerMetadata, WebSocketGatewayOptions } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type ClassDecoratorLike = StandardClassDecoratorFn;
type MethodDecoratorLike = StandardMethodDecoratorFn;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function normalizeGatewayPath(path: string | undefined): string {
  if (!path || path === '/') {
    return '/';
  }

  const normalized = `/${path.trim().replace(/^\/+/, '').replace(/\/+$/, '')}`;

  return normalized === '' ? '/' : normalized;
}

function defineStandardGatewayMetadata(metadata: unknown, options: WebSocketGatewayOptions): void {
  const bag = getStandardMetadataBag(metadata);
  bag[webSocketGatewayMetadataSymbol] = {
    path: normalizeGatewayPath(options.path),
  };
}

function defineStandardHandlerMetadata(
  metadata: unknown,
  propertyKey: string | symbol,
  handlerMetadata: WebSocketGatewayHandlerMetadata,
): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[webSocketHandlerMetadataSymbol] as Map<string | symbol, WebSocketGatewayHandlerMetadata> | undefined;
  const map = current ?? new Map<string | symbol, WebSocketGatewayHandlerMetadata>();

  map.set(propertyKey, {
    event: handlerMetadata.event,
    type: handlerMetadata.type,
  });
  bag[webSocketHandlerMetadataSymbol] = map;
}

function createMethodDecorator(metadata: WebSocketGatewayHandlerMetadata): MethodDecoratorLike {
  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    if (context.private) {
      throw new Error(`@${metadata.type === 'message' ? 'OnMessage' : metadata.type === 'connect' ? 'OnConnect' : 'OnDisconnect'}() cannot be used on private methods.`);
    }

    if (context.static) {
      throw new Error(`@${metadata.type === 'message' ? 'OnMessage' : metadata.type === 'connect' ? 'OnConnect' : 'OnDisconnect'}() cannot be used on static methods.`);
    }

    defineStandardHandlerMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}

export function WebSocketGateway<TEvents extends WebSocketEventMap = WebSocketEventMap>(
  options: WebSocketGatewayOptions<TEvents> = {},
): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext) => {
    defineStandardGatewayMetadata(context.metadata, options);
  };

  return decorator as ClassDecoratorLike;
}

export function OnMessage<
  TEvents extends WebSocketEventMap = WebSocketEventMap,
  K extends keyof TEvents = keyof TEvents,
>(event?: K & string): MethodDecoratorLike {
  return createMethodDecorator({
    event,
    type: 'message',
  });
}

export function OnConnect(): MethodDecoratorLike {
  return createMethodDecorator({
    type: 'connect',
  });
}

export function OnDisconnect(): MethodDecoratorLike {
  return createMethodDecorator({
    type: 'disconnect',
  });
}
