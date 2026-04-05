import { metadataSymbol } from '@konekti/core/internal';

import { queueWorkerMetadataSymbol } from './metadata.js';
import type { QueueJobType, QueueWorkerMetadata, QueueWorkerOptions } from './types.js';

type ClassDecoratorLike = (value: Function, context: ClassDecoratorContext) => void;
type StandardMetadataBag = Record<PropertyKey, unknown>;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function defineStandardQueueWorkerMetadata(metadata: unknown, workerMetadata: QueueWorkerMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  bag[queueWorkerMetadataSymbol] = {
    jobType: workerMetadata.jobType,
    options: { ...workerMetadata.options },
  } satisfies QueueWorkerMetadata;
}

export function QueueWorker(jobType: QueueJobType, options: QueueWorkerOptions = {}): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: QueueWorkerMetadata = {
      jobType,
      options: { ...options },
    };

    defineStandardQueueWorkerMetadata(context.metadata, metadata);
  };

  return decorator;
}
