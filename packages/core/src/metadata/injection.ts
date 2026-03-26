import { getOrCreatePropertyMap, getStandardConstructorMetadataMap, mergeMetadataPropertyKeys, standardMetadataKeys } from './shared.js';
import type { InjectionMetadata, InjectionSchemaEntry, StandardInjectionRecord } from './types.js';
import type { MetadataPropertyKey } from '../types.js';

const injectionMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, InjectionMetadata>>();

function getStandardInjectionMap(target: object): Map<MetadataPropertyKey, StandardInjectionRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardInjectionRecord>(target, standardMetadataKeys.injection);
}

export function defineInjectionMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: InjectionMetadata,
): void {
  getOrCreatePropertyMap(injectionMetadataStore, target).set(propertyKey, { ...metadata });
}

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
