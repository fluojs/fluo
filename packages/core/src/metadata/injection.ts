import type { MetadataPropertyKey } from '../types.js';
import {
  getGlobalMetadataWeakMap,
  getOrCreatePropertyMap,
  getStandardConstructorMetadataMap,
  mergeMetadataPropertyKeys,
  metadataKeys,
  standardMetadataKeys,
} from './shared.js';
import type { InjectionMetadata, InjectionSchemaEntry, StandardInjectionRecord } from './types.js';

const injectionMetadataStore = getGlobalMetadataWeakMap<object, Map<MetadataPropertyKey, InjectionMetadata>>(metadataKeys.injection);

function getStandardInjectionMap(target: object): Map<MetadataPropertyKey, StandardInjectionRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardInjectionRecord>(target, standardMetadataKeys.injection);
}

/**
 * Store a shallow copy of injection metadata for one property on the exact target.
 * Replaces the previous entry rather than merging it.
 *
 * @deprecated Will be removed in the next @fluojs/core major release.
 *
 * @param target Object whose own injection map receives the entry.
 * @param propertyKey Injection property whose previous entry is replaced.
 * @param metadata Injection record to shallow-copy into the store.
 */
export function defineInjectionMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: InjectionMetadata,
): void {
  getOrCreatePropertyMap(injectionMetadataStore, target).set(propertyKey, { ...metadata });
}

/**
 * Reconcile stored and standard injection entries in stored-key-first order.
 * Standard-only keys follow in their original order. Non-nullish stored fields override
 * standard fields, and standard-only entries with a nullish token are skipped.
 * Only the exact target's stored map is read, without prototype inheritance.
 *
 * @deprecated Will be removed in the next @fluojs/core major release.
 *
 * @param target Object whose stored and standard injection metadata is inspected.
 * @returns A fresh mutable schema with newly created entries and metadata records.
 */
export function getInjectionSchema(target: object): InjectionSchemaEntry[] {
  const stored = injectionMetadataStore.get(target) ?? new Map<MetadataPropertyKey, InjectionMetadata>();
  const standard = getStandardInjectionMap(target) ?? new Map<MetadataPropertyKey, StandardInjectionRecord>();
  const keys = mergeMetadataPropertyKeys(stored, standard);
  const schema: InjectionSchemaEntry[] = [];

  for (const propertyKey of keys) {
    const metadata = stored.get(propertyKey);
    const standardMetadata = standard.get(propertyKey);

    if (!metadata && standardMetadata?.token == null) {
      continue;
    }

    schema.push({
      propertyKey,
      metadata: {
        optional: metadata?.optional ?? standardMetadata?.optional,
        token: metadata?.token ?? standardMetadata?.token,
      },
    });
  }

  return schema;
}
