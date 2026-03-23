import type { MetadataPropertyKey } from '../types.js';

export type StandardMetadataBag = Record<PropertyKey, unknown>;

const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
export const metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('konekti.symbol.metadata');

export function ensureMetadataSymbol(): symbol {
  if (!symbolWithMetadata.metadata) {
    Object.defineProperty(Symbol, 'metadata', {
      configurable: true,
      value: metadataSymbol,
    });
  }

  return metadataSymbol;
}

void ensureMetadataSymbol();

export const standardMetadataKeys = {
  classValidation: Symbol.for('konekti.standard.class-validation'),
  controller: Symbol.for('konekti.standard.controller'),
  dtoFieldBinding: Symbol.for('konekti.standard.dto-binding'),
  dtoFieldValidation: Symbol.for('konekti.standard.dto-validation'),
  injection: Symbol.for('konekti.standard.injection'),
  route: Symbol.for('konekti.standard.route'),
} as const;

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

export function cloneCollection<T>(collection: readonly T[] | undefined): T[] | undefined {
  return collection ? [...collection] : undefined;
}

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

export function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

export function getStandardConstructorMetadataBag(target: object): StandardMetadataBag | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  return constructor ? getStandardMetadataBag(constructor) : undefined;
}

export function getStandardConstructorMetadataRecord<T>(target: object, key: symbol): T | undefined {
  return getStandardConstructorMetadataBag(target)?.[key] as T | undefined;
}

export function getStandardConstructorMetadataMap<T>(target: object, key: symbol): Map<MetadataPropertyKey, T> | undefined {
  return getStandardConstructorMetadataRecord<Map<MetadataPropertyKey, T>>(target, key);
}

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

export function appendWeakMapValue<T>(store: WeakMap<Function, T[]>, target: Function, value: T): void {
  const existing = store.get(target);

  if (existing) {
    existing.push(value);
    return;
  }

  store.set(target, [value]);
}
