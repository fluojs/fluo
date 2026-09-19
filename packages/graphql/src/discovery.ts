import type { MetadataPropertyKey, Token } from '@fluojs/core';
import { Container } from '@fluojs/di';
import type { CompiledModule } from '@fluojs/runtime';

import {
  getArgFieldMetadataEntries,
  getFieldResolverParameterMetadataEntries,
  getResolverHandlerMetadataEntries,
  getResolverMetadata,
} from './metadata.js';
import type { GraphqlModuleOptions, ResolverDescriptor } from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
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

function createEffectiveContainer(compiledModules: readonly CompiledModule[]): Container {
  const container = new Container();

  for (const compiledModule of compiledModules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      const token = typeof provider === 'function' ? provider : provider.provide;

      if (container.has(token)) {
        container.override(provider);
      } else {
        container.register(provider);
      }
    }
  }

  return container;
}

function discoveryCandidates(
  compiledModules: readonly CompiledModule[],
  container: Container,
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const moduleNameByToken = new Map<Token, string>();

  for (const compiledModule of compiledModules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      const token = typeof provider === 'function' ? provider : provider.provide;
      moduleNameByToken.set(token, compiledModule.type.name);
    }
  }

  const registrations = container.inspectResolutionState().registrations;

  for (const [token, moduleName] of moduleNameByToken) {
    const registration = registrations.get(token);

    if (!registration) {
      continue;
    }

    let targetType: Function | undefined;
    let scope: 'request' | 'singleton' | 'transient' = registration.scope;

    if (registration.type === 'class') {
      targetType = registration.useClass;
    } else if (registration.type === 'value') {
      const value = registration.useValue;
      scope = 'singleton';

      if (typeof value === 'function') {
        targetType = value;
      } else if (typeof value === 'object' && value !== null) {
        const constructor = value.constructor as Function | undefined;

        if (constructor && constructor !== Object) {
          targetType = constructor;
        }
      }
    } else if (registration.type === 'factory') {
      targetType = registration.resolverClass;
    }

    if (!targetType || typeof targetType !== 'function') {
      continue;
    }

    const resolverMetadata = getResolverMetadata(targetType);

    if (!resolverMetadata) {
      continue;
    }

    candidates.push({
      moduleName,
      scope,
      targetType,
      token,
    });
  }

  return candidates;
}

/**
 * Discover resolver descriptors.
 *
 * @param compiledModules The compiled modules.
 * @param options The options.
 * @param runtimeContainer The optional runtime container.
 * @returns The discover resolver descriptors result.
 */
export function discoverResolverDescriptors(
  compiledModules: readonly CompiledModule[],
  options: GraphqlModuleOptions,
  runtimeContainer?: Container,
): ResolverDescriptor[] {
  const container = runtimeContainer ?? createEffectiveContainer(compiledModules);
  const allowedResolvers = normalizeAllowedResolverSet(options.resolvers);
  const seenTargets = new Set<Function>();
  const descriptors: ResolverDescriptor[] = [];

  for (const candidate of discoveryCandidates(compiledModules, container)) {
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
        const parameterBindings = getFieldResolverParameterMetadataEntries(candidate.targetType.prototype, entry.propertyKey);

        if (entry.metadata.type !== 'field' && parameterBindings.length > 0) {
          throw new Error(
            `@Parent() and @Context() can only bind parameters on @FieldResolver() methods; @Args() follows the same rule. ` +
              `Invalid placement: ${candidate.targetType.name}.${methodKeyToName(entry.propertyKey)}.`,
          );
        }

        if (entry.metadata.type === 'field' && inputClass !== undefined && !parameterBindings.some((binding) => binding.kind === 'input')) {
          throw new Error(
            `@FieldResolver({ input }) requires @Args() on ${candidate.targetType.name}.${methodKeyToName(entry.propertyKey)}.`,
          );
        }

        if (entry.metadata.type === 'field' && inputClass === undefined && parameterBindings.some((binding) => binding.kind === 'input')) {
          throw new Error(
            `@Args() requires @FieldResolver({ input }) on ${candidate.targetType.name}.${methodKeyToName(entry.propertyKey)}.`,
          );
        }

        return {
          argFields,
          argTypes: entry.metadata.argTypes,
          fieldName: entry.metadata.fieldName ?? methodKeyToName(entry.propertyKey),
          inputClass,
          methodKey: entry.propertyKey,
          methodName: methodKeyToName(entry.propertyKey),
          nullable: entry.metadata.nullable,
          outputType: entry.metadata.outputType,
          parameterBindings,
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
