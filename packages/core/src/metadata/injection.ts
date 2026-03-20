import { getOrCreatePropertyMap, getStandardMetadataBag, standardMetadataKeys } from './shared.js';
import type { InjectionMetadata, InjectionSchemaEntry, StandardInjectionRecord } from './types.js';
import type { MetadataPropertyKey } from '../types.js';

const injectionMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, InjectionMetadata>>();

function getStandardInjectionMap(target: object): Map<MetadataPropertyKey, StandardInjectionRecord> | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardMetadataKeys.injection] as Map<MetadataPropertyKey, StandardInjectionRecord> | undefined)
    : undefined;
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
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);
  const schema: InjectionSchemaEntry[] = [];

  for (const propertyKey of keys) {
    const metadata = stored.get(propertyKey);
    const standardMetadata = standard.get(propertyKey);

    if (!metadata && !standardMetadata?.token) {
      continue;
    }

    schema.push({
      propertyKey,
      metadata: {
        optional: metadata?.optional ?? standardMetadata?.optional,
        token: metadata?.token ?? (standardMetadata as { token: unknown }).token,
      },
    });
  }

  return schema;
}
