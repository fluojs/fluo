import { UseGuards } from '@konekti/http';

import { AuthGuard } from './guard.js';
import { getOwnAuthRequirement } from './metadata.js';
import { mergeAuthRequirements } from './scope.js';
import type { AuthRequirement } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type ClassOrMethodDecoratorLike = StandardClassDecoratorFn & StandardMethodDecoratorFn;
type RequirementPatch = AuthRequirement;

const standardClassRequirementKey = Symbol.for('konekti.passport.standard.class-auth');
const standardMethodRequirementKey = Symbol.for('konekti.passport.standard.method-auth');

function isStandardClassContext(context: unknown): context is ClassDecoratorContext {
  return typeof context === 'object' && context !== null && 'kind' in context && context.kind === 'class';
}

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  return metadata as StandardMetadataBag;
}

function defineStandardAuthRequirement(
  metadata: unknown,
  requirement: RequirementPatch | undefined,
  propertyKey?: string | symbol,
) {
  const bag = getStandardMetadataBag(metadata);

  if (propertyKey === undefined) {
    const merged = mergeAuthRequirements(
      (bag[standardClassRequirementKey] as AuthRequirement | undefined) ?? undefined,
      requirement,
    );

    if (merged) {
      bag[standardClassRequirementKey] = merged;
      return;
    }

    delete bag[standardClassRequirementKey];
    return;
  }

  const current = bag[standardMethodRequirementKey] as Map<string | symbol, AuthRequirement> | undefined;
  const map = current ?? new Map<string | symbol, AuthRequirement>();
  const merged = mergeAuthRequirements(map.get(propertyKey), requirement);

  if (merged) {
    map.set(propertyKey, merged);
  } else {
    map.delete(propertyKey);
  }

  bag[standardMethodRequirementKey] = map;
}

function applyAuthRequirement(targetOrValue: Function, contextOrPropertyKey: ClassDecoratorContext | ClassMethodDecoratorContext, patch: RequirementPatch): void {
  if (isStandardClassContext(contextOrPropertyKey)) {
    defineStandardAuthRequirement(
      contextOrPropertyKey.metadata,
      mergeAuthRequirements(getOwnAuthRequirement(targetOrValue), patch),
    );
    UseGuards(AuthGuard)(targetOrValue, contextOrPropertyKey);
    return;
  }

  defineStandardAuthRequirement(contextOrPropertyKey.metadata, patch, contextOrPropertyKey.name);
  UseGuards(AuthGuard)(targetOrValue, contextOrPropertyKey);
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
