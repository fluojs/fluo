import type { QueueWorkerMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
const metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('konekti.symbol.metadata');

if (!symbolWithMetadata.metadata) {
  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: metadataSymbol,
  });
}

const standardQueueWorkerMetadataKey = Symbol.for('konekti.queue.standard.worker');
const queueWorkerMetadataStore = new WeakMap<Function, QueueWorkerMetadata>();

function cloneQueueWorkerMetadata(metadata: QueueWorkerMetadata): QueueWorkerMetadata {
  return {
    jobType: metadata.jobType,
    options: { ...metadata.options },
  };
}

function getStandardMetadataBag(target: Function): StandardMetadataBag | undefined {
  return (target as unknown as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardQueueWorkerMetadata(target: Function): QueueWorkerMetadata | undefined {
  return getStandardMetadataBag(target)?.[standardQueueWorkerMetadataKey] as QueueWorkerMetadata | undefined;
}

export function defineQueueWorkerMetadata(target: Function, metadata: QueueWorkerMetadata): void {
  queueWorkerMetadataStore.set(target, cloneQueueWorkerMetadata(metadata));
}

export function getQueueWorkerMetadata(target: Function): QueueWorkerMetadata | undefined {
  const stored = queueWorkerMetadataStore.get(target);
  const standard = getStandardQueueWorkerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneQueueWorkerMetadata(stored ?? standard!);
}

export const queueWorkerMetadataSymbol = standardQueueWorkerMetadataKey;
