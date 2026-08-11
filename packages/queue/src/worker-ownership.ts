import type { Token } from '@fluojs/core';
import { getRedisClientToken, getRedisComponentId } from '@fluojs/redis';
import type { CompiledModule, ModuleType } from '@fluojs/runtime';

import type { DiscoveryModuleFilter } from './helpers.js';
import type { QueueRegistrationContext } from './tokens.js';
import { QUEUE_MODULE_CONTEXT_MARKER } from './tokens.js';
import { discoverQueueWorkerDescriptors } from './worker-discovery.js';

interface QueueWorkerOwner {
  readonly moduleName: string;
  readonly scope: string;
  readonly workerName: string;
}

function isQueueModuleContext(value: unknown): value is QueueRegistrationContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    QUEUE_MODULE_CONTEXT_MARKER in value &&
    value[QUEUE_MODULE_CONTEXT_MARKER] === true &&
    'moduleType' in value &&
    typeof value.moduleType === 'function' &&
    'options' in value &&
    typeof value.options === 'object' &&
    value.options !== null &&
    'registrationTokens' in value &&
    Array.isArray(value.registrationTokens) &&
    'scope' in value &&
    typeof value.scope === 'string'
  );
}

function collectQueueModuleContexts(compiledModules: readonly CompiledModule[]): QueueRegistrationContext[] {
  const contexts: QueueRegistrationContext[] = [];

  for (const compiledModule of compiledModules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      if (typeof provider !== 'object' || provider === null || !('useValue' in provider)) {
        continue;
      }

      if (isQueueModuleContext(provider.useValue)) {
        contexts.push(provider.useValue);
      }
    }
  }

  return contexts;
}

function canReachQueueRegistration(
  compiledModule: CompiledModule,
  moduleContext: QueueRegistrationContext,
  compiledModulesByType: ReadonlyMap<ModuleType, CompiledModule>,
  visited = new Set<ModuleType>(),
): boolean {
  if (visited.has(compiledModule.type)) {
    return false;
  }

  visited.add(compiledModule.type);

  for (const importedModuleType of compiledModule.definition.imports ?? []) {
    if (importedModuleType === moduleContext.moduleType) {
      return true;
    }

    const importedModule = compiledModulesByType.get(importedModuleType);
    if (
      !importedModule ||
      !moduleContext.registrationTokens.some((token) => importedModule.exportedTokens.has(token))
    ) {
      continue;
    }

    if (canReachQueueRegistration(importedModule, moduleContext, compiledModulesByType, visited)) {
      return true;
    }
  }

  return false;
}

function createQueueDiscoveryModuleFilter(
  compiledModules: readonly CompiledModule[],
  moduleContext: QueueRegistrationContext,
): DiscoveryModuleFilter {
  if (moduleContext.options.global) {
    return () => true;
  }

  const compiledModulesByType = new Map(
    compiledModules.map((compiledModule) => [compiledModule.type, compiledModule]),
  );

  return (compiledModule) =>
    canReachQueueRegistration(compiledModule, moduleContext, compiledModulesByType);
}

function assertUniqueQueueScopes(moduleContexts: readonly QueueRegistrationContext[]): void {
  const seenScopes = new Set<string>();

  for (const moduleContext of moduleContexts) {
    if (seenScopes.has(moduleContext.scope)) {
      throw new Error(
        `Duplicate @fluojs/queue scope "${moduleContext.scope}" registered. Provide a unique QueueModule.forRoot({ scope }) value for each scoped queue registration.`,
      );
    }

    seenScopes.add(moduleContext.scope);
  }
}

function getJobOwners(
  ownersByRedisDependency: Map<Token, Map<string, QueueWorkerOwner>>,
  redisToken: Token,
): Map<string, QueueWorkerOwner> {
  const existing = ownersByRedisDependency.get(redisToken);

  if (existing) {
    return existing;
  }

  const created = new Map<string, QueueWorkerOwner>();
  ownersByRedisDependency.set(redisToken, created);
  return created;
}

/**
 * Rejects queue registrations that would assign one BullMQ queue to workers in different DI scopes.
 *
 * @param compiledModules Complete compiled application module graph.
 */
export function assertUniqueQueueWorkerOwnership(compiledModules: readonly CompiledModule[]): void {
  const moduleContexts = collectQueueModuleContexts(compiledModules);
  assertUniqueQueueScopes(moduleContexts);

  const ownersByRedisDependency = new Map<Token, Map<string, QueueWorkerOwner>>();

  for (const moduleContext of moduleContexts) {
    const redisToken = getRedisClientToken(moduleContext.options.clientName);
    const ownersByJobName = getJobOwners(ownersByRedisDependency, redisToken);
    const descriptors = discoverQueueWorkerDescriptors(
      compiledModules,
      moduleContext.options,
      undefined,
      createQueueDiscoveryModuleFilter(compiledModules, moduleContext),
    );

    for (const descriptor of descriptors.values()) {
      const existingOwner = ownersByJobName.get(descriptor.jobName);

      if (existingOwner) {
        throw new Error(
          `Cross-scope @fluojs/queue worker ownership collision for Redis dependency "${getRedisComponentId(moduleContext.options.clientName)}" and jobName "${descriptor.jobName}" between scopes "${existingOwner.scope}" (${existingOwner.workerName} in ${existingOwner.moduleName}) and "${moduleContext.scope}" (${descriptor.workerName} in ${descriptor.moduleName}). Configure a distinct QueueModule.forRoot({ clientName }) or @QueueWorker(..., { jobName }) value.`,
        );
      }

      ownersByJobName.set(descriptor.jobName, {
        moduleName: descriptor.moduleName,
        scope: moduleContext.scope,
        workerName: descriptor.workerName,
      });
    }
  }
}
