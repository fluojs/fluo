import type { MetadataPropertyKey } from '../types.js';

export type StandardMetadataBag = Record<PropertyKey, unknown>;

const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
export const metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('konekti.symbol.metadata');

if (!symbolWithMetadata.metadata) {
  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: metadataSymbol,
  });
}

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

  for (const value of values ?? []) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }

  return merged;
}

export function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}
