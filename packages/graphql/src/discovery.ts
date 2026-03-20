import { getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Provider } from '@konekti/di';
import type { ApplicationLogger, CompiledModule } from '@konekti/runtime';

import { getArgFieldMetadataEntries, getResolverHandlerMetadataEntries, getResolverMetadata } from './metadata.js';
import type { GraphqlModuleOptions, ResolverDescriptor } from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
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

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function normalizeAllowedResolverSet(resolvers: Function[] | undefined): Set<Function> | undefined {
  if (!resolvers || resolvers.length === 0) {
    return undefined;
  }

  return new Set(resolvers);
}

function discoveryCandidates(compiledModules: readonly CompiledModule[]): DiscoveryCandidate[] {
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

export function discoverResolverDescriptors(
  compiledModules: readonly CompiledModule[],
  options: GraphqlModuleOptions,
  logger: ApplicationLogger,
): ResolverDescriptor[] {
  const allowedResolvers = normalizeAllowedResolverSet(options.resolvers);
  const seenTargets = new Set<Function>();
  const descriptors: ResolverDescriptor[] = [];

  for (const candidate of discoveryCandidates(compiledModules)) {
    if (allowedResolvers && !allowedResolvers.has(candidate.targetType)) {
      continue;
    }

    const resolverMetadata = getResolverMetadata(candidate.targetType);

    if (!resolverMetadata) {
      continue;
    }

    if (candidate.scope !== 'singleton') {
      logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @Resolver() but is registered with ${candidate.scope} scope. GraphQL resolvers are registered only for singleton providers.`,
        'GraphqlLifecycleService',
      );
      continue;
    }

    if (seenTargets.has(candidate.targetType)) {
      continue;
    }

    seenTargets.add(candidate.targetType);
    descriptors.push({
      handlers: getResolverHandlerMetadataEntries(candidate.targetType.prototype).map((entry) => {
        const inputClass = entry.metadata.inputClass;
        const argFields = inputClass !== undefined ? getArgFieldMetadataEntries(inputClass.prototype).map((argField) => argField.metadata) : [];

        return {
          argFields,
          argTypes: entry.metadata.argTypes,
          fieldName: entry.metadata.fieldName ?? methodKeyToName(entry.propertyKey),
          inputClass,
          methodKey: entry.propertyKey,
          methodName: methodKeyToName(entry.propertyKey),
          outputType: entry.metadata.outputType,
          topics: entry.metadata.topics,
          type: entry.metadata.type,
        };
      }),
      moduleName: candidate.moduleName,
      targetName: candidate.targetType.name,
      token: candidate.token,
      typeName: resolverMetadata.typeName,
    });
  }

  return descriptors;
}
