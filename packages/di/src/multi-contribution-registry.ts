import type { Token } from '@fluojs/core';

type MultiContributionResolver = (token: Token, contributionIndex: number) => Promise<unknown>;

/**
 * Object identity that owns a canonical multi-provider contribution resolver.
 *
 * @internal
 */
export type MultiContributionResolverOwner = object;

const MULTI_CONTRIBUTION_RESOLVERS = Symbol.for('fluo.di.multi-contribution-resolvers');
const MULTI_CONTRIBUTION_RESOLVERS_VERSION = 1;

type SharedMultiContributionResolvers = {
  readonly resolvers: WeakMap<MultiContributionResolverOwner, MultiContributionResolver>;
  readonly version: number;
};

let incompatibleResolvers: SharedMultiContributionResolvers | undefined;

const multiContributionResolvers = resolveMultiContributionResolvers().resolvers;

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

function resolveMultiContributionResolvers(): SharedMultiContributionResolvers {
  const existing = Reflect.get(globalThis, MULTI_CONTRIBUTION_RESOLVERS);

  if (isCompatibleMultiContributionResolvers(existing)) {
    return existing;
  }

  if (existing === undefined) {
    const resolvers = createMultiContributionResolvers();
    Reflect.defineProperty(globalThis, MULTI_CONTRIBUTION_RESOLVERS, {
      configurable: true,
      value: resolvers,
      writable: false,
    });
    return resolvers;
  }

  incompatibleResolvers ??= createMultiContributionResolvers();
  return incompatibleResolvers;
}

function createMultiContributionResolvers(): SharedMultiContributionResolvers {
  return Object.freeze({
    resolvers: new WeakMap<MultiContributionResolverOwner, MultiContributionResolver>(),
    version: MULTI_CONTRIBUTION_RESOLVERS_VERSION,
  });
}

function isCompatibleMultiContributionResolvers(
  value: unknown,
): value is SharedMultiContributionResolvers {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'version') === MULTI_CONTRIBUTION_RESOLVERS_VERSION
    && Reflect.get(value, 'resolvers') instanceof WeakMap;
}
