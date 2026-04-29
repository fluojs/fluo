import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';

import { getQueueWorkerMetadata } from './metadata.js';
import { collectDiscoveryCandidates, normalizePositiveInteger, normalizeRateLimiter } from './helpers.js';
import type { NormalizedQueueModuleOptions, QueueJobType, QueueWorkerDescriptor, QueueWorkerMetadata } from './types.js';

/**
 * Discover queue worker descriptors.
 *
 * @param compiledModules The compiled modules.
 * @param options The options.
 * @param logger The logger.
 * @returns The discover queue worker descriptors result.
 */
export function discoverQueueWorkerDescriptors(
  compiledModules: readonly CompiledModule[],
  options: NormalizedQueueModuleOptions,
  logger: ApplicationLogger,
): Map<QueueJobType, QueueWorkerDescriptor> {
  const descriptorsByJobType = new Map<QueueJobType, QueueWorkerDescriptor>();
  const seenJobNames = new Set<string>();

  for (const candidate of collectDiscoveryCandidates(compiledModules)) {
    const metadata = getQueueWorkerMetadata(candidate.targetType);

    if (!metadata) {
      continue;
    }

    if (candidate.scope !== 'singleton') {
      logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @QueueWorker() but is registered with ${candidate.scope} scope. Queue workers are registered only for singleton providers.`,
        'QueueLifecycleService',
      );
      continue;
    }

    const jobType = metadata.jobType;

    if (descriptorsByJobType.has(jobType)) {
      logger.warn(
        `Duplicate @QueueWorker() registration for job type ${jobType.name} was ignored in ${candidate.moduleName}.`,
        'QueueLifecycleService',
      );
      continue;
    }

    const jobName = metadata.options.jobName ?? jobType.name;

    if (seenJobNames.has(jobName)) {
      logger.warn(
        `Duplicate queue job name ${jobName} was ignored in ${candidate.moduleName}.`,
        'QueueLifecycleService',
      );
      continue;
    }

    seenJobNames.add(jobName);
    descriptorsByJobType.set(jobType, createWorkerDescriptor(candidate.moduleName, candidate.token, candidate.targetType.name, metadata, jobName, options));
  }

  return descriptorsByJobType;
}

function createWorkerDescriptor(
  moduleName: string,
  token: QueueWorkerDescriptor['token'],
  workerName: string,
  metadata: QueueWorkerMetadata,
  jobName: string,
  options: NormalizedQueueModuleOptions,
): QueueWorkerDescriptor {
  return {
    attempts: normalizePositiveInteger(metadata.options.attempts, options.defaultAttempts),
    backoff: metadata.options.backoff ?? options.defaultBackoff,
    concurrency: normalizePositiveInteger(metadata.options.concurrency, options.defaultConcurrency),
    jobName,
    jobType: metadata.jobType,
    moduleName,
    rateLimiter: normalizeRateLimiter(metadata.options.rateLimiter ?? options.defaultRateLimiter),
    token,
    workerName,
  };
}
