import { metadataSymbol, type MetadataPropertyKey } from '@konekti/core';

import { mergeAuthRequirements, normalizeDeclaredScopes } from './scope.js';
import type { AuthRequirement } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

const standardClassRequirementKey = Symbol.for('konekti.passport.standard.class-auth');
const standardMethodRequirementKey = Symbol.for('konekti.passport.standard.method-auth');

const classRequirementStore = new WeakMap<Function, AuthRequirement>();
const methodRequirementStore = new WeakMap<object, Map<MetadataPropertyKey, AuthRequirement>>();
const mergedClassRequirementCache = new WeakMap<Function, AuthRequirement | null>();
const mergedMethodRequirementCache = new WeakMap<Function, Map<MetadataPropertyKey, AuthRequirement | null>>();

function normalizeRequirement(requirement: AuthRequirement | undefined): AuthRequirement | undefined {
  if (!requirement) {
    return undefined;
  }

  const strategy = requirement.strategy;
  const scopes = normalizeDeclaredScopes(requirement.scopes);

  if (!strategy && !scopes) {
    return undefined;
  }

  return {
    scopes,
    strategy,
  };
}

function toCacheValue(requirement: AuthRequirement | undefined): AuthRequirement | null {
  return requirement ?? null;
}

function invalidateRequirementCache(controllerType: Function, propertyKey?: MetadataPropertyKey): void {
  mergedClassRequirementCache.delete(controllerType);

  if (propertyKey === undefined) {
    mergedMethodRequirementCache.delete(controllerType);
    return;
  }

  const methodCache = mergedMethodRequirementCache.get(controllerType);

  if (!methodCache) {
    return;
  }

  methodCache.delete(propertyKey);

  if (methodCache.size === 0) {
    mergedMethodRequirementCache.delete(controllerType);
  }
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardClassRequirement(target: Function): AuthRequirement | undefined {
  return normalizeRequirement(getStandardMetadataBag(target)?.[standardClassRequirementKey] as AuthRequirement | undefined);
}

function getStandardMethodRequirement(target: object, propertyKey: MetadataPropertyKey): AuthRequirement | undefined {
  const constructor = (target as { constructor?: Function }).constructor;
  const map = constructor
    ? (getStandardMetadataBag(constructor)?.[standardMethodRequirementKey] as Map<MetadataPropertyKey, AuthRequirement> | undefined)
    : undefined;

  return normalizeRequirement(map?.get(propertyKey));
}

export function defineAuthRequirement(target: Function | object, requirement: AuthRequirement, propertyKey?: MetadataPropertyKey): void {
  const normalizedRequirement = normalizeRequirement(requirement);

  if (propertyKey === undefined) {
    const controllerType = target as Function;

    if (normalizedRequirement) {
      classRequirementStore.set(controllerType, normalizedRequirement);
    } else {
      classRequirementStore.delete(controllerType);
    }

    invalidateRequirementCache(controllerType);
    return;
  }

  let map = methodRequirementStore.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, AuthRequirement>();
    methodRequirementStore.set(target, map);
  }

  if (normalizedRequirement) {
    map.set(propertyKey, normalizedRequirement);
  } else {
    map.delete(propertyKey);
  }

  const controllerType = (target as { constructor?: Function }).constructor;

  if (controllerType) {
    invalidateRequirementCache(controllerType, propertyKey);
  }
}

export function getOwnAuthRequirement(target: Function | object, propertyKey?: MetadataPropertyKey): AuthRequirement | undefined {
  if (propertyKey === undefined) {
    return mergeAuthRequirements(classRequirementStore.get(target as Function), getStandardClassRequirement(target as Function));
  }

  return mergeAuthRequirements(methodRequirementStore.get(target)?.get(propertyKey), getStandardMethodRequirement(target, propertyKey));
}

export function getAuthRequirement(controllerType: Function, propertyKey?: MetadataPropertyKey): AuthRequirement | undefined {
  if (propertyKey === undefined) {
    if (mergedClassRequirementCache.has(controllerType)) {
      return mergedClassRequirementCache.get(controllerType) ?? undefined;
    }

    const requirement = getOwnAuthRequirement(controllerType);
    mergedClassRequirementCache.set(controllerType, toCacheValue(requirement));
    return requirement;
  }

  const methodCache = mergedMethodRequirementCache.get(controllerType);

  if (methodCache?.has(propertyKey)) {
    return methodCache.get(propertyKey) ?? undefined;
  }

  const requirement = mergeAuthRequirements(
    getOwnAuthRequirement(controllerType),
    getOwnAuthRequirement(controllerType.prototype, propertyKey),
  );

  if (methodCache) {
    methodCache.set(propertyKey, toCacheValue(requirement));
  } else {
    mergedMethodRequirementCache.set(controllerType, new Map<MetadataPropertyKey, AuthRequirement | null>([[propertyKey, toCacheValue(requirement)]]));
  }

  return requirement;
}
