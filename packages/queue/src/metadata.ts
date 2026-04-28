import { ensureSymbolMetadataPolyfill, getStandardMetadataBag } from '@fluojs/core/internal';

import type { QueueWorkerMetadata } from './types.js';

void ensureSymbolMetadataPolyfill();

const standardQueueWorkerMetadataKey = Symbol.for('fluo.queue.standard.worker');
const queueWorkerMetadataStore = new WeakMap<Function, QueueWorkerMetadata>();

function cloneQueueWorkerMetadata(metadata: QueueWorkerMetadata): QueueWorkerMetadata {
  return {
    jobType: metadata.jobType,
    options: { ...metadata.options },
  };
}

function getStandardQueueWorkerMetadata(target: Function): QueueWorkerMetadata | undefined {
  return getStandardMetadataBag(target)?.[standardQueueWorkerMetadataKey] as QueueWorkerMetadata | undefined;
}

/**
 * Define queue worker metadata.
 *
 * @param target The target.
 * @param metadata The metadata.
 */
export function defineQueueWorkerMetadata(target: Function, metadata: QueueWorkerMetadata): void {
  queueWorkerMetadataStore.set(target, cloneQueueWorkerMetadata(metadata));
}

/**
 * Get queue worker metadata.
 *
 * @param target The target.
 * @returns The get queue worker metadata result.
 */
export function getQueueWorkerMetadata(target: Function): QueueWorkerMetadata | undefined {
  const stored = queueWorkerMetadataStore.get(target);
  const standard = getStandardQueueWorkerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneQueueWorkerMetadata(stored ?? standard!);
}

/**
 * Provides the queue worker metadata symbol value.
 */
export const queueWorkerMetadataSymbol = standardQueueWorkerMetadataKey;
