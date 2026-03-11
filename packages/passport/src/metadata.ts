import type { MetadataPropertyKey } from '@konekti/core';

import type { AuthRequirement } from './types';

const classRequirementStore = new WeakMap<Function, AuthRequirement>();
const methodRequirementStore = new WeakMap<object, Map<MetadataPropertyKey, AuthRequirement>>();

function cloneRequirement(requirement: AuthRequirement | undefined): AuthRequirement | undefined {
  if (!requirement) {
    return undefined;
  }

  return {
    scopes: requirement.scopes ? [...requirement.scopes] : undefined,
    strategy: requirement.strategy,
  };
}

function mergeRequirements(base: AuthRequirement | undefined, extra: AuthRequirement | undefined): AuthRequirement | undefined {
  if (!base && !extra) {
    return undefined;
  }

  const scopes = [...(base?.scopes ?? []), ...(extra?.scopes ?? [])];

  return {
    scopes: scopes.length > 0 ? scopes : undefined,
    strategy: extra?.strategy ?? base?.strategy,
  };
}

export function defineAuthRequirement(target: Function | object, requirement: AuthRequirement, propertyKey?: MetadataPropertyKey): void {
  if (propertyKey === undefined) {
    classRequirementStore.set(target as Function, cloneRequirement(requirement)!);
    return;
  }

  let map = methodRequirementStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, AuthRequirement>();
    methodRequirementStore.set(target, map);
  }

  map.set(propertyKey, cloneRequirement(requirement)!);
}

export function getOwnAuthRequirement(target: Function | object, propertyKey?: MetadataPropertyKey): AuthRequirement | undefined {
  if (propertyKey === undefined) {
    return cloneRequirement(classRequirementStore.get(target as Function));
  }

  return cloneRequirement(methodRequirementStore.get(target)?.get(propertyKey));
}

export function getAuthRequirement(controllerType: Function, propertyKey?: MetadataPropertyKey): AuthRequirement | undefined {
  if (propertyKey === undefined) {
    return getOwnAuthRequirement(controllerType);
  }

  return mergeRequirements(
    getOwnAuthRequirement(controllerType),
    getOwnAuthRequirement(controllerType.prototype, propertyKey),
  );
}
