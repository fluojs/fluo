import { type MetadataPropertyKey } from '@fluojs/core';
import { ensureSymbolMetadataPolyfill, getStandardConstructorMetadataBag } from '@fluojs/core/internal';

import type { CronTaskMetadata, SchedulingTaskMetadata } from './types.js';

void ensureSymbolMetadataPolyfill();

const standardSchedulingMetadataKey = Symbol.for('fluo.cron.standard.task');

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

/**
 * Get scheduling task metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get scheduling task metadata result.
 */
export function getSchedulingTaskMetadata(target: object, propertyKey: MetadataPropertyKey): SchedulingTaskMetadata | undefined {
  const standard = getStandardSchedulingMap(target)?.get(propertyKey);

  if (!standard) {
    return undefined;
  }

  return cloneTaskMetadata(standard);
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
  const standard = getStandardSchedulingMap(target) ?? new Map<MetadataPropertyKey, SchedulingTaskMetadata>();

  return Array.from(standard.keys())
    .map((propertyKey) => ({
      metadata: getSchedulingTaskMetadata(target, propertyKey),
      propertyKey,
    }))
    .filter((entry): entry is { metadata: SchedulingTaskMetadata; propertyKey: MetadataPropertyKey } => entry.metadata !== undefined);
}

/**
 * Provides the scheduling metadata symbol value.
 */
export const schedulingMetadataSymbol = standardSchedulingMetadataKey;
