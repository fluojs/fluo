import type { MetadataPropertyKey } from '@konekti/core';
import { UseGuard } from '@konekti/http';

import { AuthGuard } from './guard';
import { defineAuthRequirement, getOwnAuthRequirement } from './metadata';

function mergeRequirement(
  existing: ReturnType<typeof getOwnAuthRequirement>,
  partial: { scopes?: string[]; strategy?: string },
) {
  const scopes = [...(existing?.scopes ?? []), ...(partial.scopes ?? [])];

  return {
    scopes: scopes.length > 0 ? scopes : undefined,
    strategy: partial.strategy ?? existing?.strategy,
  };
}

function attachAuthGuard(target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor): void {
  if (propertyKey === undefined) {
    UseGuard(AuthGuard)(target as Function);
    return;
  }

  const resolvedDescriptor = descriptor ?? Object.getOwnPropertyDescriptor(target, propertyKey);

  if (!resolvedDescriptor) {
    throw new TypeError(`Missing descriptor for auth decorator on ${String(propertyKey)}.`);
  }

  UseGuard(AuthGuard)(target, propertyKey, resolvedDescriptor);
}

export function UseAuth(strategy: string): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (propertyKey === undefined) {
      defineAuthRequirement(target as Function, mergeRequirement(getOwnAuthRequirement(target as Function), { strategy }));
      attachAuthGuard(target);
      return;
    }

    defineAuthRequirement(
      target,
      mergeRequirement(getOwnAuthRequirement(target, propertyKey as MetadataPropertyKey), { strategy }),
      propertyKey as MetadataPropertyKey,
    );
    attachAuthGuard(target, propertyKey, descriptor);
  };
}

export function RequireScopes(...scopes: string[]): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (propertyKey === undefined) {
      defineAuthRequirement(target as Function, mergeRequirement(getOwnAuthRequirement(target as Function), { scopes }));
      attachAuthGuard(target);
      return;
    }

    defineAuthRequirement(
      target,
      mergeRequirement(getOwnAuthRequirement(target, propertyKey as MetadataPropertyKey), { scopes }),
      propertyKey as MetadataPropertyKey,
    );
    attachAuthGuard(target, propertyKey, descriptor);
  };
}
