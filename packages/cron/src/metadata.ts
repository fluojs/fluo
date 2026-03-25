import { ensureSymbolMetadataPolyfill, metadataSymbol, type MetadataPropertyKey } from '@konekti/core';

import type { CronTaskMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

void ensureSymbolMetadataPolyfill();

const standardCronMetadataKey = Symbol.for('konekti.cron.standard.task');
const cronMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, CronTaskMetadata>>();

function cloneTaskMetadata(metadata: CronTaskMetadata): CronTaskMetadata {
  return {
    expression: metadata.expression,
    options: { ...metadata.options },
  };
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardCronMap(target: object): Map<MetadataPropertyKey, CronTaskMetadata> | undefined {
  const constructor = (target as { constructor?: object }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardCronMetadataKey] as Map<MetadataPropertyKey, CronTaskMetadata> | undefined)
    : undefined;
}

function getOrCreateCronMap(target: object): Map<MetadataPropertyKey, CronTaskMetadata> {
  let map = cronMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, CronTaskMetadata>();
    cronMetadataStore.set(target, map);
  }

  return map;
}

export function defineCronTaskMetadata(target: object, propertyKey: MetadataPropertyKey, metadata: CronTaskMetadata): void {
  getOrCreateCronMap(target).set(propertyKey, cloneTaskMetadata(metadata));
}

export function getCronTaskMetadata(target: object, propertyKey: MetadataPropertyKey): CronTaskMetadata | undefined {
  const stored = cronMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardCronMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneTaskMetadata(stored ?? standard!);
}

export function getCronTaskMetadataEntries(target: object): Array<{ metadata: CronTaskMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = cronMetadataStore.get(target) ?? new Map<MetadataPropertyKey, CronTaskMetadata>();
  const standard = getStandardCronMap(target) ?? new Map<MetadataPropertyKey, CronTaskMetadata>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: getCronTaskMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter((entry): entry is { metadata: CronTaskMetadata; propertyKey: MetadataPropertyKey } => entry.metadata !== undefined);
}

export const cronMetadataSymbol = standardCronMetadataKey;
