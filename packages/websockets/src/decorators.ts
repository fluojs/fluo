import { metadataSymbol } from '@fluojs/core/internal';

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
    serverBacked: options.serverBacked
      ? {
          port: options.serverBacked.port,
        }
      : undefined,
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

/**
 * Marks a class as a WebSocket gateway discovered during module bootstrap.
 *
 * @param options Gateway path and optional server-backed listener configuration.
 * @returns A class decorator that stores gateway metadata for runtime discovery.
 *
 * @example
 * ```ts
 * import { WebSocketGateway } from '@fluojs/websockets';
 *
 * @WebSocketGateway({ path: '/chat' })
 * class ChatGateway {}
 * ```
 *
 * @remarks
 * Multiple gateways may share one `path`; handlers run in discovery order.
 */
export function WebSocketGateway(
  options: WebSocketGatewayOptions = {},
): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext) => {
    defineStandardGatewayMetadata(context.metadata, options);
  };

  return decorator as ClassDecoratorLike;
}

/**
 * Registers a method as an inbound message handler for a gateway.
 *
 * @param event Optional event name filter. When omitted, the runtime treats the handler as a generic message listener.
 * @returns A method decorator that records message-handler metadata for the gateway.
 *
 * @example
 * ```ts
 * import { OnMessage } from '@fluojs/websockets';
 *
 * class ChatGateway {
 *   @OnMessage('ping')
 *   handlePing(payload: unknown) {
 *     return payload;
 *   }
 * }
 * ```
 */
export function OnMessage<
  TEvents extends WebSocketEventMap = WebSocketEventMap,
  K extends keyof TEvents = keyof TEvents,
>(event?: K & string): MethodDecoratorLike {
  return createMethodDecorator({
    event,
    type: 'message',
  });
}

/**
 * Registers a method that runs when one client connection is established.
 *
 * @returns A method decorator that records a connection lifecycle handler.
 */
export function OnConnect(): MethodDecoratorLike {
  return createMethodDecorator({
    type: 'connect',
  });
}

/**
 * Registers a method that runs when one client disconnects from the gateway.
 *
 * @returns A method decorator that records a disconnection lifecycle handler.
 */
export function OnDisconnect(): MethodDecoratorLike {
  return createMethodDecorator({
    type: 'disconnect',
  });
}
