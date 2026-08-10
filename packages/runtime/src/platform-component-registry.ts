import { InvariantError } from '@fluojs/core';

import type {
  PlatformComponent,
  PlatformComponentInput,
  PlatformComponentRegistration,
} from './platform-contract.js';

export interface RegisteredPlatformComponent {
  readonly component: PlatformComponent;
  readonly dependencies: readonly string[];
}

function isRegistration(value: PlatformComponentInput): value is PlatformComponentRegistration {
  return typeof value === 'object' && value !== null && 'component' in value;
}

function normalizeRegistration(input: PlatformComponentInput): RegisteredPlatformComponent {
  if (isRegistration(input)) {
    return {
      component: input.component,
      dependencies: [...(input.dependencies ?? [])],
    };
  }

  return {
    component: input,
    dependencies: [],
  };
}

export function registerPlatformComponents(
  components: readonly PlatformComponentInput[] | undefined,
): RegisteredPlatformComponent[] {
  return (components ?? []).map((component) => normalizeRegistration(component));
}

export function assertValidPlatformComponentGraph(components: readonly RegisteredPlatformComponent[]): void {
  const ids = new Set<string>();

  for (const registration of components) {
    if (!registration.component.id || registration.component.id.trim().length === 0) {
      throw new InvariantError('Platform component id must be a non-empty string.');
    }

    if (ids.has(registration.component.id)) {
      throw new InvariantError(`Duplicate platform component id "${registration.component.id}" is not allowed.`);
    }

    ids.add(registration.component.id);
  }

  for (const registration of components) {
    for (const dependency of registration.dependencies) {
      if (!ids.has(dependency)) {
        throw new InvariantError(
          `Platform component "${registration.component.id}" depends on unknown component "${dependency}".`,
        );
      }

      if (dependency === registration.component.id) {
        throw new InvariantError(`Platform component "${registration.component.id}" cannot depend on itself.`);
      }
    }
  }
}

export function orderPlatformComponents(
  components: readonly RegisteredPlatformComponent[],
): RegisteredPlatformComponent[] {
  const byId = new Map(components.map((registration) => [registration.component.id, registration]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: RegisteredPlatformComponent[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }

    if (visiting.has(id)) {
      throw new InvariantError(`Platform component dependency cycle detected at "${id}".`);
    }

    visiting.add(id);

    const registration = byId.get(id);
    if (!registration) {
      throw new InvariantError(`Platform component "${id}" is missing from runtime registration.`);
    }

    for (const dependency of registration.dependencies) {
      visit(dependency);
    }

    visiting.delete(id);
    visited.add(id);
    ordered.push(registration);
  };

  for (const registration of components) {
    visit(registration.component.id);
  }

  return ordered;
}
