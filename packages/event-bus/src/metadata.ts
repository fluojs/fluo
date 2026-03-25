import { ensureSymbolMetadataPolyfill, metadataSymbol, type MetadataPropertyKey } from '@konekti/core';

import type { EventHandlerMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

void ensureSymbolMetadataPolyfill();

const standardEventHandlerMetadataKey = Symbol.for('konekti.event-bus.standard.handler');
const eventHandlerMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, EventHandlerMetadata>>();

function cloneEventHandlerMetadata(metadata: EventHandlerMetadata): EventHandlerMetadata {
  return {
    eventType: metadata.eventType,
  };
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardEventHandlerMap(target: object): Map<MetadataPropertyKey, EventHandlerMetadata> | undefined {
  const constructor = (target as { constructor?: object }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardEventHandlerMetadataKey] as Map<MetadataPropertyKey, EventHandlerMetadata> | undefined)
    : undefined;
}

function getOrCreateEventHandlerMap(target: object): Map<MetadataPropertyKey, EventHandlerMetadata> {
  let map = eventHandlerMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, EventHandlerMetadata>();
    eventHandlerMetadataStore.set(target, map);
  }

  return map;
}

export function defineEventHandlerMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: EventHandlerMetadata,
): void {
  getOrCreateEventHandlerMap(target).set(propertyKey, cloneEventHandlerMetadata(metadata));
}

export function getEventHandlerMetadata(target: object, propertyKey: MetadataPropertyKey): EventHandlerMetadata | undefined {
  const stored = eventHandlerMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardEventHandlerMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneEventHandlerMetadata(stored ?? standard!);
}

export function getEventHandlerMetadataEntries(
  target: object,
): Array<{ metadata: EventHandlerMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = eventHandlerMetadataStore.get(target) ?? new Map<MetadataPropertyKey, EventHandlerMetadata>();
  const standard = getStandardEventHandlerMap(target) ?? new Map<MetadataPropertyKey, EventHandlerMetadata>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: getEventHandlerMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter((entry): entry is { metadata: EventHandlerMetadata; propertyKey: MetadataPropertyKey } => entry.metadata !== undefined);
}

export const eventBusMetadataSymbol = standardEventHandlerMetadataKey;
