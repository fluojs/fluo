import { type MetadataPropertyKey, type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { FactoryProvider, Provider, ValueProvider } from '@fluojs/di';
import type { CompiledModule } from '@fluojs/runtime';

import { getArgFieldMetadataEntries, getResolverHandlerMetadataEntries, getResolverMetadata } from './metadata.js';
import type { GraphqlModuleOptions, ResolverDescriptor } from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

function scopeFromProvider(provider: Provider, factoryResolverClass?: Function): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? (factoryResolverClass ? getClassDiMetadata(factoryResolverClass)?.scope : undefined) ?? 'singleton';
  }

  return 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function isValueProvider(provider: Provider): provider is ValueProvider {
  return typeof provider === 'object' && provider !== null && 'useValue' in provider;
}

function isFactoryProvider(provider: Provider): provider is FactoryProvider {
  return typeof provider === 'object' && provider !== null && 'useFactory' in provider;
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
        continue;
      }

      if (isValueProvider(provider)) {
        const value = provider.useValue;

        if (typeof value === 'function') {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: 'singleton',
            targetType: value,
            token: provider.provide,
          });
          continue;
        }

        if (typeof value === 'object' && value !== null) {
          const constructor = value.constructor as Function | undefined;

          if (constructor && constructor !== Object) {
            candidates.push({
              moduleName: compiledModule.type.name,
              scope: 'singleton',
              targetType: constructor,
              token: provider.provide,
            });
          }
        }

        continue;
      }

      if (isFactoryProvider(provider)) {
        const resolverClass = (provider as FactoryProvider & { resolverClass?: Function }).resolverClass;

        if (resolverClass) {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider, resolverClass),
            targetType: resolverClass,
            token: provider.provide,
          });
        }
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

/**
 * Discover resolver descriptors.
 *
 * @param compiledModules The compiled modules.
 * @param options The options.
 * @returns The discover resolver descriptors result.
 */
export function discoverResolverDescriptors(
  compiledModules: readonly CompiledModule[],
  options: GraphqlModuleOptions,
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
      scope: candidate.scope,
      targetName: candidate.targetType.name,
      token: candidate.token,
      typeName: resolverMetadata.typeName,
    });
  }

  return descriptors;
}
