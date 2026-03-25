import { ensureSymbolMetadataPolyfill, metadataSymbol, type MetadataPropertyKey } from '@konekti/core';

import type { HandlerMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

void ensureSymbolMetadataPolyfill();

const standardMicroserviceMetadataKey = Symbol.for('konekti.microservices.standard.handler');
const handlerMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, HandlerMetadata[]>>();

function cloneHandlerMetadata(metadata: HandlerMetadata): HandlerMetadata {
  return {
    kind: metadata.kind,
    pattern: metadata.pattern,
  };
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardHandlerMap(target: object): Map<MetadataPropertyKey, HandlerMetadata[]> | undefined {
  const constructor = (target as { constructor?: object }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardMicroserviceMetadataKey] as Map<MetadataPropertyKey, HandlerMetadata[]> | undefined)
    : undefined;
}

function getOrCreateHandlerMap(target: object): Map<MetadataPropertyKey, HandlerMetadata[]> {
  let map = handlerMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, HandlerMetadata[]>();
    handlerMetadataStore.set(target, map);
  }

  return map;
}

export function defineHandlerMetadata(target: object, propertyKey: MetadataPropertyKey, metadata: HandlerMetadata): void {
  const map = getOrCreateHandlerMap(target);
  const current = map.get(propertyKey) ?? [];
  current.push(cloneHandlerMetadata(metadata));
  map.set(propertyKey, current);
}

export function getHandlerMetadataEntries(
  target: object,
): Array<{ metadata: HandlerMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = handlerMetadataStore.get(target) ?? new Map<MetadataPropertyKey, HandlerMetadata[]>();
  const standard = getStandardHandlerMap(target) ?? new Map<MetadataPropertyKey, HandlerMetadata[]>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);
  const entries: Array<{ metadata: HandlerMetadata; propertyKey: MetadataPropertyKey }> = [];

  for (const propertyKey of keys) {
    const metadataList = [...(stored.get(propertyKey) ?? []), ...(standard.get(propertyKey) ?? [])];

    for (const metadata of metadataList) {
      entries.push({
        metadata: cloneHandlerMetadata(metadata),
        propertyKey,
      });
    }
  }

  return entries;
}

export const microserviceMetadataSymbol = standardMicroserviceMetadataKey;
