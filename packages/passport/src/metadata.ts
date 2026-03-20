import { metadataSymbol, type MetadataPropertyKey } from '@konekti/core';

import { mergeAuthRequirements, normalizeDeclaredScopes } from './scope.js';
import type { AuthRequirement } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

const standardClassRequirementKey = Symbol.for('konekti.passport.standard.class-auth');
const standardMethodRequirementKey = Symbol.for('konekti.passport.standard.method-auth');

const classRequirementStore = new WeakMap<Function, AuthRequirement>();
const methodRequirementStore = new WeakMap<object, Map<MetadataPropertyKey, AuthRequirement>>();

function cloneRequirement(requirement: AuthRequirement | undefined): AuthRequirement | undefined {
  if (!requirement) {
    return undefined;
  }

  return {
    scopes: normalizeDeclaredScopes(requirement.scopes),
    strategy: requirement.strategy,
  };
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardClassRequirement(target: Function): AuthRequirement | undefined {
  return cloneRequirement(getStandardMetadataBag(target)?.[standardClassRequirementKey] as AuthRequirement | undefined);
}

function getStandardMethodRequirement(target: object, propertyKey: MetadataPropertyKey): AuthRequirement | undefined {
  const constructor = (target as { constructor?: Function }).constructor;
  const map = constructor
    ? (getStandardMetadataBag(constructor)?.[standardMethodRequirementKey] as Map<MetadataPropertyKey, AuthRequirement> | undefined)
    : undefined;

  return cloneRequirement(map?.get(propertyKey));
}

export function defineAuthRequirement(target: Function | object, requirement: AuthRequirement, propertyKey?: MetadataPropertyKey): void {
  if (propertyKey === undefined) {
    classRequirementStore.set(target as Function, cloneRequirement(requirement) as AuthRequirement);
    return;
  }

  let map = methodRequirementStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, AuthRequirement>();
    methodRequirementStore.set(target, map);
  }

  map.set(propertyKey, cloneRequirement(requirement) as AuthRequirement);
}

export function getOwnAuthRequirement(target: Function | object, propertyKey?: MetadataPropertyKey): AuthRequirement | undefined {
  if (propertyKey === undefined) {
    return mergeAuthRequirements(cloneRequirement(classRequirementStore.get(target as Function)), getStandardClassRequirement(target as Function));
  }

  return mergeAuthRequirements(cloneRequirement(methodRequirementStore.get(target)?.get(propertyKey)), getStandardMethodRequirement(target, propertyKey));
}

export function getAuthRequirement(controllerType: Function, propertyKey?: MetadataPropertyKey): AuthRequirement | undefined {
  if (propertyKey === undefined) {
    return getOwnAuthRequirement(controllerType);
  }

  return mergeAuthRequirements(
    getOwnAuthRequirement(controllerType),
    getOwnAuthRequirement(controllerType.prototype, propertyKey),
  );
}
