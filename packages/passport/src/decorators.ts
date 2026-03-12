import { UseGuard } from '@konekti/http';

import { AuthGuard } from './guard';
import { getOwnAuthRequirement } from './metadata';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type ClassOrMethodDecoratorLike = StandardClassDecoratorFn & StandardMethodDecoratorFn;
type RequirementPatch = { scopes?: string[]; strategy?: string };

const standardClassRequirementKey = Symbol.for('konekti.passport.standard.class-auth');
const standardMethodRequirementKey = Symbol.for('konekti.passport.standard.method-auth');

function mergeRequirement(existing: ReturnType<typeof getOwnAuthRequirement>, partial: RequirementPatch) {
  const scopes = [...(existing?.scopes ?? []), ...(partial.scopes ?? [])];

  return {
    scopes: scopes.length > 0 ? scopes : undefined,
    strategy: partial.strategy ?? existing?.strategy,
  };
}

function isStandardClassContext(context: unknown): context is ClassDecoratorContext {
  return typeof context === 'object' && context !== null && 'kind' in context && context.kind === 'class';
}

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  return metadata as StandardMetadataBag;
}

function defineStandardAuthRequirement(metadata: unknown, requirement: ReturnType<typeof mergeRequirement>, propertyKey?: string | symbol) {
  const bag = getStandardMetadataBag(metadata);

  if (propertyKey === undefined) {
    bag[standardClassRequirementKey] = mergeRequirement(
      (bag[standardClassRequirementKey] as ReturnType<typeof mergeRequirement> | undefined) ?? undefined,
      requirement,
    );
    return;
  }

  const current = bag[standardMethodRequirementKey] as Map<string | symbol, ReturnType<typeof mergeRequirement>> | undefined;
  const map = current ?? new Map<string | symbol, ReturnType<typeof mergeRequirement>>();
  map.set(propertyKey, mergeRequirement(map.get(propertyKey), requirement));
  bag[standardMethodRequirementKey] = map;
}

function applyAuthRequirement(targetOrValue: Function, contextOrPropertyKey: ClassDecoratorContext | ClassMethodDecoratorContext, patch: RequirementPatch): void {
  if (isStandardClassContext(contextOrPropertyKey)) {
    defineStandardAuthRequirement(contextOrPropertyKey.metadata, mergeRequirement(getOwnAuthRequirement(targetOrValue), patch));
    UseGuard(AuthGuard)(targetOrValue, contextOrPropertyKey);
    return;
  }

  defineStandardAuthRequirement(contextOrPropertyKey.metadata, mergeRequirement(undefined, patch), contextOrPropertyKey.name);
  UseGuard(AuthGuard)(targetOrValue, contextOrPropertyKey);
}

function createAuthRequirementDecorator(patch: RequirementPatch): ClassOrMethodDecoratorLike {
  const decorator = (targetOrValue: Function, contextOrPropertyKey: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    applyAuthRequirement(targetOrValue, contextOrPropertyKey, patch);
  };

  return decorator as ClassOrMethodDecoratorLike;
}

export function UseAuth(strategy: string): ClassOrMethodDecoratorLike {
  return createAuthRequirementDecorator({ strategy });
}

export function RequireScopes(...scopes: string[]): ClassOrMethodDecoratorLike {
  return createAuthRequirementDecorator({ scopes });
}
