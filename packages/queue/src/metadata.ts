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
 * Stores queue worker metadata for a decorated worker class.
 *
 * @param target Decorated worker class that owns the metadata.
 * @param metadata Job type and worker options to store for the class.
 */
export function defineQueueWorkerMetadata(target: Function, metadata: QueueWorkerMetadata): void {
  queueWorkerMetadataStore.set(target, cloneQueueWorkerMetadata(metadata));
}

/**
 * Reads queue worker metadata for a decorated worker class.
 *
 * @param target Worker class whose metadata should be read.
 * @returns A cloned metadata snapshot, or `undefined` when the class has no queue worker metadata.
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
