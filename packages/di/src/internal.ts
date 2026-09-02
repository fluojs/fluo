import type { Token } from '@fluojs/core';

import { ContainerResolutionError } from './errors.js';
import {
  type MultiContributionResolverOwner,
  multiContributionResolverFor,
} from './multi-contribution-registry.js';

/**
 * Resolves one ordered multi-provider contribution through its owning container.
 *
 * This integration seam is for Fluo packages such as `@fluojs/runtime` and
 * `@fluojs/testing`; application code must use `Container.resolve(...)`.
 *
 * @param container Container that owns the multi-provider registration.
 * @param token Multi-provider token.
 * @param contributionIndex Provider-order index for the contribution.
 * @returns The canonical container-resolved contribution instance.
 * @throws {ContainerResolutionError} When the container has no registered internal resolver.
 */
export async function resolveMultiContribution(
  container: MultiContributionResolverOwner,
  token: Token,
  contributionIndex: number,
): Promise<unknown> {
  const resolver = multiContributionResolverFor(container);

  if (!resolver) {
    throw new ContainerResolutionError(
      'Container does not expose the internal multi-provider contribution resolver.',
      { token, hint: 'Create the container through the @fluojs/di Container constructor.' },
    );
  }

  return resolver(token, contributionIndex);
}

export { validateProviderInputs } from './provider-normalization.js';
export type { Provider } from './types.js';
