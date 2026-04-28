import type { MetadataPropertyKey } from '@fluojs/core';
import { ensureSymbolMetadataPolyfill, getStandardConstructorMetadataBag, getStandardMetadataBag } from '@fluojs/core/internal';

import type {
  WebSocketGatewayHandlerMetadata,
  WebSocketGatewayMetadata,
} from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

void ensureSymbolMetadataPolyfill();

const standardWebSocketGatewayMetadataKey = Symbol.for('fluo.websocket.standard.gateway');
const standardWebSocketHandlerMetadataKey = Symbol.for('fluo.websocket.standard.handler');

const gatewayMetadataStore = new WeakMap<object, WebSocketGatewayMetadata>();
const handlerMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata>>();

function cloneGatewayMetadata(metadata: WebSocketGatewayMetadata): WebSocketGatewayMetadata {
  return {
    path: metadata.path,
    serverBacked: metadata.serverBacked
      ? {
          port: metadata.serverBacked.port,
        }
      : undefined,
  };
}

function cloneHandlerMetadata(metadata: WebSocketGatewayHandlerMetadata): WebSocketGatewayHandlerMetadata {
  return {
    event: metadata.event,
    type: metadata.type,
  };
}

function getStandardGatewayMetadata(target: object): WebSocketGatewayMetadata | undefined {
  const metadata = getStandardMetadataBag(target)?.[standardWebSocketGatewayMetadataKey] as
    | WebSocketGatewayMetadata
    | undefined;

  if (!metadata) {
    return undefined;
  }

  return cloneGatewayMetadata(metadata);
}

function getStandardHandlerMap(target: object): Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata> | undefined {
  return getStandardConstructorMetadataBag(target)?.[standardWebSocketHandlerMetadataKey] as
    | Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata>
    | undefined;
}

function getOrCreateHandlerMetadataMap(target: object): Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata> {
  let map = handlerMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata>();
    handlerMetadataStore.set(target, map);
  }

  return map;
}

export function defineWebSocketGatewayMetadata(target: object, metadata: WebSocketGatewayMetadata): void {
  gatewayMetadataStore.set(target, cloneGatewayMetadata(metadata));
}

export function getWebSocketGatewayMetadata(target: object): WebSocketGatewayMetadata | undefined {
  const stored = gatewayMetadataStore.get(target);
  const standard = getStandardGatewayMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneGatewayMetadata(stored ?? standard!);
}

export function defineWebSocketHandlerMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: WebSocketGatewayHandlerMetadata,
): void {
  getOrCreateHandlerMetadataMap(target).set(propertyKey, cloneHandlerMetadata(metadata));
}

export function getWebSocketHandlerMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
): WebSocketGatewayHandlerMetadata | undefined {
  const stored = handlerMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardHandlerMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneHandlerMetadata(stored ?? standard!);
}

export function getWebSocketHandlerMetadataEntries(
  target: object,
): Array<{ metadata: WebSocketGatewayHandlerMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = handlerMetadataStore.get(target) ?? new Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata>();
  const standard = getStandardHandlerMap(target) ?? new Map<MetadataPropertyKey, WebSocketGatewayHandlerMetadata>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: getWebSocketHandlerMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter(
      (entry): entry is { metadata: WebSocketGatewayHandlerMetadata; propertyKey: MetadataPropertyKey } =>
        entry.metadata !== undefined,
    );
}

export const webSocketGatewayMetadataSymbol = standardWebSocketGatewayMetadataKey;
export const webSocketHandlerMetadataSymbol = standardWebSocketHandlerMetadataKey;
