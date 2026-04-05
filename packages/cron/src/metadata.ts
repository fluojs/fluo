import { type MetadataPropertyKey } from '@konekti/core';
import { ensureSymbolMetadataPolyfill, metadataSymbol } from '@konekti/core/internal';

import type { CronTaskMetadata, SchedulingTaskMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

void ensureSymbolMetadataPolyfill();

const standardSchedulingMetadataKey = Symbol.for('konekti.cron.standard.task');
const schedulingMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, SchedulingTaskMetadata>>();

function cloneTaskMetadata(metadata: SchedulingTaskMetadata): SchedulingTaskMetadata {
  if (metadata.kind === 'cron') {
    return {
      expression: metadata.expression,
      kind: 'cron',
      options: { ...metadata.options },
    };
  }

  if (metadata.kind === 'interval') {
    return {
      kind: 'interval',
      ms: metadata.ms,
      options: { ...metadata.options },
    };
  }

  return {
    kind: 'timeout',
    ms: metadata.ms,
    options: { ...metadata.options },
  };
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardSchedulingMap(target: object): Map<MetadataPropertyKey, SchedulingTaskMetadata> | undefined {
  const constructor = (target as { constructor?: object }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardSchedulingMetadataKey] as Map<MetadataPropertyKey, SchedulingTaskMetadata> | undefined)
    : undefined;
}

function getOrCreateSchedulingMap(target: object): Map<MetadataPropertyKey, SchedulingTaskMetadata> {
  let map = schedulingMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, SchedulingTaskMetadata>();
    schedulingMetadataStore.set(target, map);
  }

  return map;
}

export function defineSchedulingTaskMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: SchedulingTaskMetadata,
): void {
  getOrCreateSchedulingMap(target).set(propertyKey, cloneTaskMetadata(metadata));
}

export function defineCronTaskMetadata(target: object, propertyKey: MetadataPropertyKey, metadata: CronTaskMetadata): void {
  defineSchedulingTaskMetadata(target, propertyKey, metadata);
}

export function getSchedulingTaskMetadata(target: object, propertyKey: MetadataPropertyKey): SchedulingTaskMetadata | undefined {
  const stored = schedulingMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardSchedulingMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneTaskMetadata(stored ?? standard!);
}

export function getCronTaskMetadata(target: object, propertyKey: MetadataPropertyKey): CronTaskMetadata | undefined {
  const metadata = getSchedulingTaskMetadata(target, propertyKey);

  return metadata?.kind === 'cron' ? metadata : undefined;
}

export function getSchedulingTaskMetadataEntries(
  target: object,
): Array<{ metadata: SchedulingTaskMetadata; propertyKey: MetadataPropertyKey }> {
  const stored = schedulingMetadataStore.get(target) ?? new Map<MetadataPropertyKey, SchedulingTaskMetadata>();
  const standard = getStandardSchedulingMap(target) ?? new Map<MetadataPropertyKey, SchedulingTaskMetadata>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      metadata: getSchedulingTaskMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter((entry): entry is { metadata: SchedulingTaskMetadata; propertyKey: MetadataPropertyKey } => entry.metadata !== undefined);
}

export function getCronTaskMetadataEntries(target: object): Array<{ metadata: CronTaskMetadata; propertyKey: MetadataPropertyKey }> {
  return getSchedulingTaskMetadataEntries(target).filter(
    (entry): entry is { metadata: CronTaskMetadata; propertyKey: MetadataPropertyKey } => entry.metadata.kind === 'cron',
  );
}

export const schedulingMetadataSymbol = standardSchedulingMetadataKey;
export const cronMetadataSymbol = standardSchedulingMetadataKey;
