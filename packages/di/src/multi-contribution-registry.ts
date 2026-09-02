import type { Token } from '@fluojs/core';

import type { Container } from './container.js';

type MultiContributionResolver = (token: Token, contributionIndex: number) => Promise<unknown>;

const multiContributionResolvers = new WeakMap<Container, MultiContributionResolver>();

/**
 * Associates a container with its canonical multi-provider contribution resolver.
 *
 * @internal
 * @param container Container that owns the resolver.
 * @param resolver Container-bound resolver that preserves DI lifecycle invariants.
 */
export function registerMultiContributionResolver(container: Container, resolver: MultiContributionResolver): void {
  multiContributionResolvers.set(container, resolver);
}

/**
 * Retrieves the canonical multi-provider contribution resolver for a container.
 *
 * @internal
 * @param container Container that owns the resolver.
 * @returns The container-bound resolver, if the container registered one.
 */
export function multiContributionResolverFor(container: Container): MultiContributionResolver | undefined {
  return multiContributionResolvers.get(container);
}
