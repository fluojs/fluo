import type { MetadataPropertyKey } from '../types.js';
import { fallbackClone } from '../utils.js';

/**
 * Generic metadata bag shape used by the TC39 `Symbol.metadata` integration points.
 */
export type StandardMetadataBag = Record<PropertyKey, unknown>;

const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
/**
 * Active symbol key used to read and write standard metadata bags.
 */
export let metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('konekti.symbol.metadata');

/**
 * Ensures `Symbol.metadata` exists and returns the symbol used by Konekti metadata helpers.
 *
 * @returns The resolved metadata symbol.
 */
export function ensureMetadataSymbol(): symbol {
  if (symbolWithMetadata.metadata) {
    metadataSymbol = symbolWithMetadata.metadata;
    return metadataSymbol;
  }

  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: metadataSymbol,
  });

  return metadataSymbol;
}

void ensureMetadataSymbol();

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Clones mutable metadata payloads before storing or returning them from shared metadata helpers.
 *
 * @param value Metadata value to clone defensively.
 * @returns A detached clone for supported mutable shapes, or the original value for immutable references.
 */
export function cloneMutableValue<T>(value: T): T {
  if (Array.isArray(value) || value instanceof Date || value instanceof Map || value instanceof Set || isPlainObject(value)) {
    return fallbackClone(value);
  }

  return value;
}

/**
 * Canonical symbol keys for metadata emitted through the standard decorator metadata bag.
 */
export const standardMetadataKeys = {
  classValidation: Symbol.for('konekti.standard.class-validation'),
  controller: Symbol.for('konekti.standard.controller'),
  dtoFieldBinding: Symbol.for('konekti.standard.dto-binding'),
  dtoFieldValidation: Symbol.for('konekti.standard.dto-validation'),
  injection: Symbol.for('konekti.standard.injection'),
  route: Symbol.for('konekti.standard.route'),
} as const;

/**
 * Canonical symbol keys for Konekti-owned metadata stores.
 */
export const metadataKeys = {
  module: Symbol.for('konekti.metadata.module'),
  controller: Symbol.for('konekti.metadata.controller'),
  route: Symbol.for('konekti.metadata.route'),
  dtoFieldBinding: Symbol.for('konekti.metadata.dto-field-binding'),
  dtoFieldValidation: Symbol.for('konekti.metadata.dto-field-validation'),
  injection: Symbol.for('konekti.metadata.injection'),
  classDi: Symbol.for('konekti.metadata.class-di'),
  classValidation: Symbol.for('konekti.metadata.class-validation'),
} as const;

/**
 * Clones a readonly collection into a mutable array for defensive metadata reads and writes.
 *
 * @param collection Collection to clone.
 * @returns A cloned mutable array, or `undefined` when the collection is absent.
 */
export function cloneCollection<T>(collection: readonly T[] | undefined): T[] | undefined {
  return collection ? collection.map((value) => cloneMutableValue(value)) : undefined;
}

/**
 * Looks up or creates a property-keyed metadata map for a target object.
 *
 * @param store WeakMap-backed metadata store.
 * @param target Target object that owns the metadata map.
 * @returns The existing or newly created metadata map for the target.
 */
export function getOrCreatePropertyMap<T>(
  store: WeakMap<object, Map<MetadataPropertyKey, T>>,
  target: object,
): Map<MetadataPropertyKey, T> {
  let map = store.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, T>();
    store.set(target, map);
  }

  return map;
}

/**
 * Merges two arrays into a single deduplicated array, preserving insertion order.
 * Deduplication uses reference equality (===), so two objects with identical shapes
 * are treated as distinct entries unless they are the exact same reference.
 * Returns `undefined` when both inputs are empty or absent.
 *
 * @param existing Existing values in insertion order.
 * @param values Additional values to merge.
 * @returns A deduplicated merged array, or `undefined` when both inputs are empty.
 */
export function mergeUnique<T>(existing: readonly T[] | undefined, values: readonly T[] | undefined): T[] | undefined {
  if (!existing?.length && !values?.length) {
    return undefined;
  }

  const merged = [...(existing ?? [])];
  const seen = new Set(merged);

  for (const value of values ?? []) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}

/**
 * Reads the standard metadata bag stored directly on a target.
 *
 * @param target Target object that may own standard metadata.
 * @returns The metadata bag when present, otherwise `undefined`.
 */
export function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  const metadata = Reflect.get(target, metadataSymbol);

  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }

  return metadata as StandardMetadataBag;
}

/**
 * Reads the standard metadata bag stored on a target's constructor.
 *
 * @param target Instance or prototype whose constructor metadata should be inspected.
 * @returns The constructor metadata bag when present, otherwise `undefined`.
 */
export function getStandardConstructorMetadataBag(target: object): StandardMetadataBag | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  return constructor ? getStandardMetadataBag(constructor) : undefined;
}

/**
 * Reads a constructor-level metadata record from the standard metadata bag.
 *
 * @param target Instance or prototype whose constructor metadata should be inspected.
 * @param key Symbol key of the stored metadata record.
 * @returns The stored record when present, otherwise `undefined`.
 */
export function getStandardConstructorMetadataRecord<T>(target: object, key: symbol): T | undefined {
  return getStandardConstructorMetadataBag(target)?.[key] as T | undefined;
}

/**
 * Reads a constructor-level property map from the standard metadata bag.
 *
 * @param target Instance or prototype whose constructor metadata should be inspected.
 * @param key Symbol key of the stored metadata map.
 * @returns The stored property map when present, otherwise `undefined`.
 */
export function getStandardConstructorMetadataMap<T>(target: object, key: symbol): Map<MetadataPropertyKey, T> | undefined {
  return getStandardConstructorMetadataRecord<Map<MetadataPropertyKey, T>>(target, key);
}

/**
 * Merges stored and standard metadata property keys while preserving first-seen order.
 *
 * @param stored Property keys from the explicit Konekti store.
 * @param standard Property keys from the standard metadata bag.
 * @returns A deduplicated ordered list of metadata property keys.
 */
export function mergeMetadataPropertyKeys<TStored, TStandard>(
  stored: ReadonlyMap<MetadataPropertyKey, TStored> | undefined,
  standard: ReadonlyMap<MetadataPropertyKey, TStandard> | undefined,
): MetadataPropertyKey[] {
  const keys: MetadataPropertyKey[] = [];
  const seen = new Set<MetadataPropertyKey>();

  for (const source of [stored, standard]) {
    if (!source) {
      continue;
    }

    for (const key of source.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  return keys;
}

/**
 * Appends a value into a property-keyed array store, creating the array on first write.
 *
 * @param store WeakMap-backed property store.
 * @param target Target object that owns the property map.
 * @param propertyKey Property key associated with the array entry.
 * @param value Value to append.
 */
export function appendPropertyMapValue<T>(
  store: WeakMap<object, Map<MetadataPropertyKey, T[]>>,
  target: object,
  propertyKey: MetadataPropertyKey,
  value: T,
): void {
  const map = getOrCreatePropertyMap(store, target);
  const existing = map.get(propertyKey);

  if (existing) {
    existing.push(value);
    return;
  }

  map.set(propertyKey, [value]);
}

/**
 * Appends a value into a WeakMap-backed array store, creating the array on first write.
 *
 * @param store WeakMap-backed array store.
 * @param target Target function used as the WeakMap key.
 * @param value Value to append.
 */
export function appendWeakMapValue<T>(store: WeakMap<Function, T[]>, target: Function, value: T): void {
  const existing = store.get(target);

  if (existing) {
    existing.push(value);
    return;
  }

  store.set(target, [value]);
}
