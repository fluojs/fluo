import { type MetadataPropertyKey } from '@fluojs/core';
import { ensureSymbolMetadataPolyfill, getStandardConstructorMetadataBag } from '@fluojs/core/internal';

import type { CronTaskMetadata, SchedulingTaskMetadata } from './types.js';

void ensureSymbolMetadataPolyfill();

const standardSchedulingMetadataKey = Symbol.for('fluo.cron.standard.task');
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

function getStandardSchedulingMap(target: object): Map<MetadataPropertyKey, SchedulingTaskMetadata> | undefined {
  return getStandardConstructorMetadataBag(target)?.[standardSchedulingMetadataKey] as
    | Map<MetadataPropertyKey, SchedulingTaskMetadata>
    | undefined;
}

function getOrCreateSchedulingMap(target: object): Map<MetadataPropertyKey, SchedulingTaskMetadata> {
  let map = schedulingMetadataStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, SchedulingTaskMetadata>();
    schedulingMetadataStore.set(target, map);
  }

  return map;
}

/**
 * Define scheduling task metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @param metadata The metadata.
 */
export function defineSchedulingTaskMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: SchedulingTaskMetadata,
): void {
  getOrCreateSchedulingMap(target).set(propertyKey, cloneTaskMetadata(metadata));
}

/**
 * Define cron task metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @param metadata The metadata.
 */
export function defineCronTaskMetadata(target: object, propertyKey: MetadataPropertyKey, metadata: CronTaskMetadata): void {
  defineSchedulingTaskMetadata(target, propertyKey, metadata);
}

/**
 * Get scheduling task metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get scheduling task metadata result.
 */
export function getSchedulingTaskMetadata(target: object, propertyKey: MetadataPropertyKey): SchedulingTaskMetadata | undefined {
  const stored = schedulingMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardSchedulingMap(target)?.get(propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneTaskMetadata(stored ?? standard!);
}

/**
 * Get cron task metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get cron task metadata result.
 */
export function getCronTaskMetadata(target: object, propertyKey: MetadataPropertyKey): CronTaskMetadata | undefined {
  const metadata = getSchedulingTaskMetadata(target, propertyKey);

  return metadata?.kind === 'cron' ? metadata : undefined;
}

/**
 * Get scheduling task metadata entries.
 *
 * @param target The target.
 * @returns The get scheduling task metadata entries result.
 */
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

/**
 * Get cron task metadata entries.
 *
 * @param target The target.
 * @returns The get cron task metadata entries result.
 */
export function getCronTaskMetadataEntries(target: object): Array<{ metadata: CronTaskMetadata; propertyKey: MetadataPropertyKey }> {
  return getSchedulingTaskMetadataEntries(target).filter(
    (entry): entry is { metadata: CronTaskMetadata; propertyKey: MetadataPropertyKey } => entry.metadata.kind === 'cron',
  );
}

/**
 * Provides the scheduling metadata symbol value.
 */
export const schedulingMetadataSymbol = standardSchedulingMetadataKey;
/**
 * Provides the cron metadata symbol value.
 */
export const cronMetadataSymbol = standardSchedulingMetadataKey;
