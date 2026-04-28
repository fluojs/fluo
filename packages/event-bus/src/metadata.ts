import { type MetadataPropertyKey } from '@fluojs/core';
import { ensureSymbolMetadataPolyfill, getStandardConstructorMetadataBag } from '@fluojs/core/internal';

import type { EventHandlerMetadata } from './types.js';

void ensureSymbolMetadataPolyfill();

const standardEventHandlerMetadataKey = Symbol.for('fluo.event-bus.standard.handler');
const eventHandlerMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, EventHandlerMetadata>>();

function cloneEventHandlerMetadata(metadata: EventHandlerMetadata): EventHandlerMetadata {
  return {
    eventType: metadata.eventType,
  };
}

function getStandardEventHandlerMap(target: object): Map<MetadataPropertyKey, EventHandlerMetadata> | undefined {
  return getStandardConstructorMetadataBag(target)?.[standardEventHandlerMetadataKey] as
    | Map<MetadataPropertyKey, EventHandlerMetadata>
    | undefined;
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
