import { metadataSymbol } from '@fluojs/core/internal';

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

/**
 * Marks a singleton provider class as the worker for one queue job type.
 *
 * @param jobType Job constructor used for discovery, queue naming, and payload rehydration.
 * @param options Optional execution settings such as retries, concurrency, and backoff.
 * @returns A class decorator that stores worker metadata for bootstrap-time discovery.
 *
 * @example
 * ```ts
 * import { QueueWorker } from '@fluojs/queue';
 *
 * class SendEmailJob {
 *   constructor(public readonly email: string) {}
 * }
 *
 * @QueueWorker(SendEmailJob, { attempts: 3, backoff: { type: 'exponential', delayMs: 1_000 } })
 * export class SendEmailWorker {
 *   async handle(job: SendEmailJob) {
 *     await mailer.send(job.email);
 *   }
 * }
 * ```
 */
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
