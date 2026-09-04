import type { ApplicationLogger, CompiledModule, ModuleType } from '@fluojs/runtime';

import type { DiscoveryModuleFilter } from './helpers.js';
import type { QueueRegistrationContext } from './tokens.js';
import { QUEUE_MODULE_CONTEXT_MARKER } from './tokens.js';
import { discoverQueueWorkerDescriptors } from './worker-discovery.js';

interface QueueWorkerOwner {
  readonly ownershipEnforcement: 'warn' | 'reject';
  readonly ownershipNamespace?: string;
  readonly moduleName: string;
  readonly scope: string;
  readonly workerName: string;
}

const UNCONFIGURED_BACKEND_IDENTITY = '(unconfigured)';

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

function canShareBackend(
  ownershipNamespace: string | undefined,
  existingOwner: QueueWorkerOwner,
): boolean {
  return (
    ownershipNamespace === undefined ||
    existingOwner.ownershipNamespace === undefined ||
    ownershipNamespace === existingOwner.ownershipNamespace
  );
}

/**
 * Validates queue registrations that would assign one BullMQ queue to workers in different DI scopes.
 *
 * @param compiledModules Complete compiled application module graph.
 * @param logger Application logger used for compatibility diagnostics.
 * @param validationModuleType Queue registration module that triggers this one-time application-wide validation.
 */
export function assertUniqueQueueWorkerOwnership(
  compiledModules: readonly CompiledModule[],
  logger: ApplicationLogger,
  validationModuleType: ModuleType,
): void {
  const moduleContexts = collectQueueModuleContexts(compiledModules);
  assertUniqueQueueScopes(moduleContexts);

  if (moduleContexts[0]?.moduleType !== validationModuleType) {
    return;
  }

  const ownersByJobName = new Map<string, QueueWorkerOwner[]>();

  for (const moduleContext of moduleContexts) {
    const ownershipNamespace = moduleContext.options.ownershipNamespace;

    if (ownershipNamespace === undefined) {
      logger.warn(
        `Queue ownership namespace is unconfigured for scope "${moduleContext.scope}". Set QueueModule.forRoot({ ownershipNamespace }) to a stable identity shared only by registrations that use the same BullMQ backend.`,
        'QueueLifecycleService',
      );
    }

    const descriptors = discoverQueueWorkerDescriptors(
      compiledModules,
      moduleContext.options,
      undefined,
      createQueueDiscoveryModuleFilter(compiledModules, moduleContext),
    );

    for (const descriptor of descriptors.values()) {
      const owners = ownersByJobName.get(descriptor.jobName) ?? [];
      const compatibleOwners = owners.filter((owner) => canShareBackend(ownershipNamespace, owner));
      const existingOwner =
        compatibleOwners.find((owner) => owner.ownershipEnforcement === 'reject') ??
        compatibleOwners[0];

      if (existingOwner) {
        const backendIdentity =
          ownershipNamespace === undefined || existingOwner.ownershipNamespace === undefined
            ? UNCONFIGURED_BACKEND_IDENTITY
            : ownershipNamespace;
        const message =
          `Cross-scope @fluojs/queue worker ownership collision for backend identity "${backendIdentity}" and jobName "${descriptor.jobName}" between scopes "${existingOwner.scope}" (${existingOwner.workerName} in ${existingOwner.moduleName}) and "${moduleContext.scope}" (${descriptor.workerName} in ${descriptor.moduleName}).`;

        if (
          existingOwner.ownershipEnforcement === 'reject' ||
          moduleContext.options.ownershipEnforcement === 'reject'
        ) {
          throw new Error(
            `${message} Configure distinct ownershipNamespace or @QueueWorker(..., { jobName }) values.`,
          );
        }

        logger.warn(
          `${message} Set matching QueueModule.forRoot({ ownershipNamespace }) values for registrations that share one BullMQ backend, then opt into ownershipEnforcement: "reject" to fail before BullMQ resources are created.`,
          'QueueLifecycleService',
        );
      }

      owners.push({
        moduleName: descriptor.moduleName,
        ownershipEnforcement: moduleContext.options.ownershipEnforcement,
        ownershipNamespace,
        scope: moduleContext.scope,
        workerName: descriptor.workerName,
      });
      ownersByJobName.set(descriptor.jobName, owners);
    }
  }
}
