import type { MetadataPropertyKey } from '@fluojs/core';
import { ensureSymbolMetadataPolyfill, getStandardConstructorMetadataBag, getStandardMetadataBag } from '@fluojs/core/internal';

import type { ArgFieldMetadata, ResolverHandlerMetadata, ResolverMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

void ensureSymbolMetadataPolyfill();

const standardResolverMetadataKey = Symbol.for('fluo.graphql.standard.resolver');
const standardHandlerMetadataKey = Symbol.for('fluo.graphql.standard.handler');
const standardArgFieldMetadataKey = Symbol.for('fluo.graphql.standard.arg-field');

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
    argTypes: metadata.argTypes,
    fieldName: metadata.fieldName,
    inputClass: metadata.inputClass,
    outputType: metadata.outputType,
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

function getStandardResolverMetadata(target: object): ResolverMetadata | undefined {
  const metadata = getStandardMetadataBag(target)?.[standardResolverMetadataKey] as ResolverMetadata | undefined;

  if (!metadata) {
    return undefined;
  }

  return cloneResolverMetadata(metadata);
}

function getStandardHandlerMap(target: object): Map<MetadataPropertyKey, ResolverHandlerMetadata> | undefined {
  return getStandardConstructorMetadataBag(target)?.[standardHandlerMetadataKey] as
    | Map<MetadataPropertyKey, ResolverHandlerMetadata>
    | undefined;
}

function getStandardArgFieldMap(target: object): Map<MetadataPropertyKey, ArgFieldMetadata> | undefined {
  return getStandardConstructorMetadataBag(target)?.[standardArgFieldMetadataKey] as
    | Map<MetadataPropertyKey, ArgFieldMetadata>
    | undefined;
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

function getMergedMetadataEntries<T>(
  target: object,
  stored: Map<MetadataPropertyKey, T> | undefined,
  standard: Map<MetadataPropertyKey, T> | undefined,
  resolve: (target: object, propertyKey: MetadataPropertyKey) => T | undefined,
): Array<{ metadata: T; propertyKey: MetadataPropertyKey }> {
  const storedMap = stored ?? new Map<MetadataPropertyKey, T>();
  const standardMap = standard ?? new Map<MetadataPropertyKey, T>();
  const keys = new Set<MetadataPropertyKey>([...storedMap.keys(), ...standardMap.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: resolve(target, propertyKey),
      propertyKey,
    }))
    .filter(
      (entry): entry is { metadata: T; propertyKey: MetadataPropertyKey } =>
        entry.metadata !== undefined,
    );
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
  return getMergedMetadataEntries(
    target,
    handlerMetadataStore.get(target),
    getStandardHandlerMap(target),
    getResolverHandlerMetadata,
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
  return getMergedMetadataEntries(target, argFieldMetadataStore.get(target), getStandardArgFieldMap(target), getArgFieldMetadata);
}

export const resolverMetadataSymbol = standardResolverMetadataKey;
export const handlerMetadataSymbol = standardHandlerMetadataKey;
export const argMetadataSymbol = standardArgFieldMetadataKey;
