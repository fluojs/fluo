import type { Token } from '@fluojs/core';

type MultiContributionResolver = (token: Token, contributionIndex: number) => Promise<unknown>;

/**
 * Object identity that owns a canonical multi-provider contribution resolver.
 *
 * @internal
 */
export type MultiContributionResolverOwner = object;

const multiContributionResolvers = new WeakMap<MultiContributionResolverOwner, MultiContributionResolver>();

/**
 * Associates a container with its canonical multi-provider contribution resolver.
 *
 * @internal
 * @param container Container that owns the resolver.
 * @param resolver Container-bound resolver that preserves DI lifecycle invariants.
 */
export function registerMultiContributionResolver(
  container: MultiContributionResolverOwner,
  resolver: MultiContributionResolver,
): void {
  multiContributionResolvers.set(container, resolver);
}

/**
 * Retrieves the canonical multi-provider contribution resolver for a container.
 *
 * @internal
 * @param container Container that owns the resolver.
 * @returns The container-bound resolver, if the container registered one.
 */
export function multiContributionResolverFor(
  container: MultiContributionResolverOwner,
): MultiContributionResolver | undefined {
  return multiContributionResolvers.get(container);
}
