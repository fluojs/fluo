import type { MetadataPropertyKey, Token } from '@fluojs/core';
import type { Container, NormalizedProvider } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';

import { getSchedulingTaskMetadataEntries } from './metadata.js';
import type { CronTaskDescriptor, NormalizedCronModuleOptions } from './types.js';

interface DiscoveryCandidate {
  readonly contributionIndex?: number;
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

/** Framework-owned invocation identity, never exposed by registry snapshots. @internal */
export interface CronTaskInvocationDescriptor extends CronTaskDescriptor {
  readonly contributionIndex?: number;
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
 * Asserts that a scheduling task name can be used as a registry key.
 *
 * @param name Scheduling task name supplied by a decorator or registry call.
 */
export function assertValidSchedulingTaskName(name: string): void {
  if (name.trim().length === 0) {
    throw new Error('Scheduling task name must be a non-empty string.');
  }
}

/**
 * Resolves the effective scheduling task name while preserving authored names.
 *
 * @param defaultName Name derived from the decorated target or registry argument.
 * @param optionName Optional name override supplied in scheduling options.
 * @returns The effective task name used by the scheduler registry.
 */
export function resolveSchedulingTaskName(defaultName: string, optionName?: string): string {
  assertValidSchedulingTaskName(defaultName);

  if (optionName !== undefined) {
    assertValidSchedulingTaskName(optionName);
    return optionName;
  }

  return defaultName;
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
 * @param container The container owning effective normalized registrations.
 * @param compiledModules The compiled modules used for display attribution.
 * @param context Scheduling options and logger.
 * @returns The discover cron task descriptors result.
 */
export function discoverCronTaskDescriptors(
  container: Container,
  compiledModules: readonly CompiledModule[],
  context: { readonly options: NormalizedCronModuleOptions; readonly logger: ApplicationLogger },
): CronTaskInvocationDescriptor[] {
  const { options, logger } = context;
  const descriptors: CronTaskInvocationDescriptor[] = [];

  for (const candidate of collectDiscoveryCandidates(container, compiledModules)) {
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
      const taskName = resolveSchedulingTaskName(
        buildDefaultTaskName(candidate.targetType.name, methodName),
        entry.metadata.options.name,
      );
      const lockTtlMs = entry.metadata.options.lockTtlMs ?? options.distributed.lockTtlMs;

      const descriptor: CronTaskInvocationDescriptor = {
        afterRun: entry.metadata.options.afterRun,
        beforeRun: entry.metadata.options.beforeRun,
        contributionIndex: candidate.contributionIndex,
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

function collectDiscoveryCandidates(container: Container, compiledModules: readonly CompiledModule[]): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const state = container.inspectResolutionState();
  const append = (provider: NormalizedProvider, contributionIndex?: number) => {
    if (provider.type !== 'class' || !provider.useClass) {
      return;
    }
    const targetType = provider.useClass;
    // Compiled declarations supply labels only; scope and invocation belong to DI.
    const module = compiledModules.find((compiled) =>
      compiled.definition.controllers?.includes(targetType)
      || compiled.definition.providers?.some((declared) =>
        typeof declared === 'function'
          ? declared === provider.provide && declared === targetType
          : declared.provide === provider.provide && 'useClass' in declared && declared.useClass === targetType,
      ),
    );
    candidates.push({
      contributionIndex,
      moduleName: module?.type.name ?? targetType.name,
      scope: provider.scope,
      targetType,
      token: provider.provide,
    });
  };
  for (const provider of state.registrations.values()) {
    append(provider);
  }
  for (const providers of state.multiRegistrations.values()) {
    for (const [index, provider] of providers.entries()) {
      append(provider, index);
    }
  }
  return candidates;
}
