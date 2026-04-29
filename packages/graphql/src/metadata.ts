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

/**
 * Define resolver metadata.
 *
 * @param target The target.
 * @param metadata The metadata.
 */
export function defineResolverMetadata(target: object, metadata: ResolverMetadata): void {
  resolverMetadataStore.set(target, cloneResolverMetadata(metadata));
}

/**
 * Get resolver metadata.
 *
 * @param target The target.
 * @returns The get resolver metadata result.
 */
export function getResolverMetadata(target: object): ResolverMetadata | undefined {
  const stored = resolverMetadataStore.get(target);
  const standard = getStandardResolverMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneResolverMetadata(stored ?? standard!);
}

/**
 * Define resolver handler metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @param metadata The metadata.
 */
export function defineResolverHandlerMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: ResolverHandlerMetadata,
): void {
  getOrCreateHandlerMetadataMap(target).set(propertyKey, cloneHandlerMetadata(metadata));
}

/**
 * Get resolver handler metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get resolver handler metadata result.
 */
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

/**
 * Get resolver handler metadata entries.
 *
 * @param target The target.
 * @returns The get resolver handler metadata entries result.
 */
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

/**
 * Define arg field metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @param metadata The metadata.
 */
export function defineArgFieldMetadata(target: object, propertyKey: MetadataPropertyKey, metadata: ArgFieldMetadata): void {
  getOrCreateArgFieldMetadataMap(target).set(propertyKey, cloneArgFieldMetadata(metadata));
}

/**
 * Get arg field metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get arg field metadata result.
 */
export function getArgFieldMetadata(target: object, propertyKey: MetadataPropertyKey): ArgFieldMetadata | undefined {
  const stored = argFieldMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardArgFieldMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneArgFieldMetadata(stored ?? standard!);
}

/**
 * Get arg field metadata entries.
 *
 * @param target The target.
 * @returns The get arg field metadata entries result.
 */
export function getArgFieldMetadataEntries(
  target: object,
): Array<{ metadata: ArgFieldMetadata; propertyKey: MetadataPropertyKey }> {
  return getMergedMetadataEntries(target, argFieldMetadataStore.get(target), getStandardArgFieldMap(target), getArgFieldMetadata);
}

/**
 * Provides the resolver metadata symbol value.
 */
export const resolverMetadataSymbol = standardResolverMetadataKey;
/**
 * Provides the handler metadata symbol value.
 */
export const handlerMetadataSymbol = standardHandlerMetadataKey;
/**
 * Provides the arg metadata symbol value.
 */
export const argMetadataSymbol = standardArgFieldMetadataKey;
