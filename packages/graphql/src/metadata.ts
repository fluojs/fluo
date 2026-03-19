import type { MetadataPropertyKey } from '@konekti/core';

import type { ArgFieldMetadata, ResolverHandlerMetadata, ResolverMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
const metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('konekti.symbol.metadata');

if (!symbolWithMetadata.metadata) {
  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: metadataSymbol,
  });
}

const standardResolverMetadataKey = Symbol.for('konekti.graphql.standard.resolver');
const standardHandlerMetadataKey = Symbol.for('konekti.graphql.standard.handler');
const standardArgFieldMetadataKey = Symbol.for('konekti.graphql.standard.arg-field');

const resolverMetadataStore = new WeakMap<object, ResolverMetadata>();
const handlerMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, ResolverHandlerMetadata>>();
const argFieldMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, ArgFieldMetadata>>();

function cloneResolverMetadata(metadata: ResolverMetadata): ResolverMetadata {
  return {
    typeName: metadata.typeName,
  };
}

function cloneHandlerMetadata(metadata: ResolverHandlerMetadata): ResolverHandlerMetadata {
  return {
    fieldName: metadata.fieldName,
    inputClass: metadata.inputClass,
    topics: metadata.topics,
    type: metadata.type,
  };
}

function cloneArgFieldMetadata(metadata: ArgFieldMetadata): ArgFieldMetadata {
  return {
    argName: metadata.argName,
    fieldName: metadata.fieldName,
  };
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardResolverMetadata(target: object): ResolverMetadata | undefined {
  const metadata = getStandardMetadataBag(target)?.[standardResolverMetadataKey] as ResolverMetadata | undefined;

  if (!metadata) {
    return undefined;
  }

  return cloneResolverMetadata(metadata);
}

function getStandardHandlerMap(target: object): Map<MetadataPropertyKey, ResolverHandlerMetadata> | undefined {
  const constructor = (target as { constructor?: object }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardHandlerMetadataKey] as
        | Map<MetadataPropertyKey, ResolverHandlerMetadata>
        | undefined)
    : undefined;
}

function getStandardArgFieldMap(target: object): Map<MetadataPropertyKey, ArgFieldMetadata> | undefined {
  const constructor = (target as { constructor?: object }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardArgFieldMetadataKey] as Map<MetadataPropertyKey, ArgFieldMetadata> | undefined)
    : undefined;
}

function getOrCreateHandlerMetadataMap(target: object): Map<MetadataPropertyKey, ResolverHandlerMetadata> {
  let map = handlerMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, ResolverHandlerMetadata>();
    handlerMetadataStore.set(target, map);
  }

  return map;
}

function getOrCreateArgFieldMetadataMap(target: object): Map<MetadataPropertyKey, ArgFieldMetadata> {
  let map = argFieldMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, ArgFieldMetadata>();
    argFieldMetadataStore.set(target, map);
  }

  return map;
}

export function defineResolverMetadata(target: object, metadata: ResolverMetadata): void {
  resolverMetadataStore.set(target, cloneResolverMetadata(metadata));
}

export function getResolverMetadata(target: object): ResolverMetadata | undefined {
  const stored = resolverMetadataStore.get(target);
  const standard = getStandardResolverMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneResolverMetadata(stored ?? standard!);
}

export function defineResolverHandlerMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: ResolverHandlerMetadata,
): void {
  getOrCreateHandlerMetadataMap(target).set(propertyKey, cloneHandlerMetadata(metadata));
}

export function getResolverHandlerMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
): ResolverHandlerMetadata | undefined {
  const stored = handlerMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardHandlerMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneHandlerMetadata(stored ?? standard!);
}

export function getResolverHandlerMetadataEntries(
  target: object,
): Array<{ metadata: ResolverHandlerMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = handlerMetadataStore.get(target) ?? new Map<MetadataPropertyKey, ResolverHandlerMetadata>();
  const standard = getStandardHandlerMap(target) ?? new Map<MetadataPropertyKey, ResolverHandlerMetadata>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: getResolverHandlerMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter(
      (entry): entry is { metadata: ResolverHandlerMetadata; propertyKey: MetadataPropertyKey } =>
        entry.metadata !== undefined,
    );
}

export function defineArgFieldMetadata(target: object, propertyKey: MetadataPropertyKey, metadata: ArgFieldMetadata): void {
  getOrCreateArgFieldMetadataMap(target).set(propertyKey, cloneArgFieldMetadata(metadata));
}

export function getArgFieldMetadata(target: object, propertyKey: MetadataPropertyKey): ArgFieldMetadata | undefined {
  const stored = argFieldMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardArgFieldMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneArgFieldMetadata(stored ?? standard!);
}

export function getArgFieldMetadataEntries(
  target: object,
): Array<{ metadata: ArgFieldMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = argFieldMetadataStore.get(target) ?? new Map<MetadataPropertyKey, ArgFieldMetadata>();
  const standard = getStandardArgFieldMap(target) ?? new Map<MetadataPropertyKey, ArgFieldMetadata>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: getArgFieldMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter(
      (entry): entry is { metadata: ArgFieldMetadata; propertyKey: MetadataPropertyKey } =>
        entry.metadata !== undefined,
    );
}

export const resolverMetadataSymbol = standardResolverMetadataKey;
export const handlerMetadataSymbol = standardHandlerMetadataKey;
export const argMetadataSymbol = standardArgFieldMetadataKey;
