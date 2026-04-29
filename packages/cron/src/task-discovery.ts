import { type MetadataPropertyKey, type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { Provider } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';

import { getSchedulingTaskMetadataEntries } from './metadata.js';
import type { CronTaskDescriptor, NormalizedCronModuleOptions } from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

/**
 * Build default task name.
 *
 * @param targetName The target name.
 * @param methodName The method name.
 * @returns The build default task name result.
 */
export function buildDefaultTaskName(targetName: string, methodName: string): string {
  return `${targetName}.${methodName}`;
}

/**
 * Create lock key.
 *
 * @param prefix The prefix.
 * @param taskName The task name.
 * @returns The create lock key result.
 */
export function createLockKey(prefix: string, taskName: string): string {
  return `${prefix}:${taskName}`;
}

/**
 * Method key to name.
 *
 * @param methodKey The method key.
 * @returns The method key to name result.
 */
export function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

/**
 * Discover cron task descriptors.
 *
 * @param compiledModules The compiled modules.
 * @param options The options.
 * @param logger The logger.
 * @returns The discover cron task descriptors result.
 */
export function discoverCronTaskDescriptors(
  compiledModules: readonly CompiledModule[],
  options: NormalizedCronModuleOptions,
  logger: ApplicationLogger,
): CronTaskDescriptor[] {
  const seen = new Map<Function, Set<string>>();
  const descriptors: CronTaskDescriptor[] = [];

  for (const candidate of collectDiscoveryCandidates(compiledModules)) {
    const entries = getSchedulingTaskMetadataEntries(candidate.targetType.prototype);

    if (candidate.scope !== 'singleton') {
      if (entries.length > 0) {
        logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares scheduling methods (@Cron/@Interval/@Timeout) but is registered with ${candidate.scope} scope. Scheduling tasks are run only for singleton providers.`,
          'CronLifecycleService',
        );
      }

      continue;
    }

    for (const entry of entries) {
      const methodName = methodKeyToName(entry.propertyKey);
      const taskName = entry.metadata.options.name ?? buildDefaultTaskName(candidate.targetType.name, methodName);
      const seenMethods = seen.get(candidate.targetType) ?? new Set<string>();
      const lockTtlMs = entry.metadata.options.lockTtlMs ?? options.distributed.lockTtlMs;

      if (seenMethods.has(methodName)) {
        continue;
      }

      seenMethods.add(methodName);
      seen.set(candidate.targetType, seenMethods);

      const descriptor: CronTaskDescriptor = {
        afterRun: entry.metadata.options.afterRun,
        beforeRun: entry.metadata.options.beforeRun,
        distributed: entry.metadata.options.distributed ?? true,
        kind: entry.metadata.kind,
        lockKey: createLockKey(options.distributed.keyPrefix, entry.metadata.options.key ?? taskName),
        lockTtlMs,
        methodKey: entry.propertyKey,
        methodName,
        moduleName: candidate.moduleName,
        onError: entry.metadata.options.onError,
        onSuccess: entry.metadata.options.onSuccess,
        targetName: candidate.targetType.name,
        taskName,
        token: candidate.token,
      };

      if (entry.metadata.kind === 'cron') {
        descriptor.expression = entry.metadata.expression;
        descriptor.timezone = entry.metadata.options.timezone;
      } else {
        descriptor.ms = entry.metadata.ms;
      }

      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function collectDiscoveryCandidates(compiledModules: readonly CompiledModule[]): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  for (const compiledModule of compiledModules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      if (typeof provider === 'function') {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(provider),
          targetType: provider,
          token: provider,
        });
        continue;
      }

      if (isClassProvider(provider)) {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(provider),
          targetType: provider.useClass,
          token: provider.provide,
        });
      }
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      candidates.push({
        moduleName: compiledModule.type.name,
        scope: scopeFromProvider(controller),
        targetType: controller,
        token: controller,
      });
    }
  }

  return candidates;
}
