import type { Token } from '@fluojs/core';
import type { Container, Provider } from '@fluojs/di';

import { providerToken } from '../module-graph.js';
import type { BootstrapEffectiveProviders } from '../types.js';
import { isDirectSingletonContextProvider } from './provider-policy.js';

/**
 * Shell-local promises for eligible singleton lookups.
 *
 * @internal
 */
export type ContextResolutionCache = Map<Token, Promise<unknown>>;
/**
 * Tokens eligible for shell-local singleton lookup caching.
 *
 * @internal
 */
export type ContextCacheableTokens = Set<Token>;
type CacheInvalidatingContainer = Container & { override(...providers: Provider[]): Container };

/**
 * Selects effective root singleton tokens for shell-local lookup caching.
 *
 * @internal
 * @param effectiveProviders Winning providers selected during bootstrap.
 * @param runtimeTokens Runtime tokens available in the returned shell.
 * @returns The initial shell-local eligibility set.
 */
export function createContextCacheableTokenSet(
  effectiveProviders: BootstrapEffectiveProviders,
  runtimeTokens: readonly Token[],
): Set<Token> {
  const cacheableTokens = new Set<Token>(runtimeTokens);

  for (const provider of effectiveProviders.runtimeProviders) {
    if (!isDirectSingletonContextProvider(provider)) {
      continue;
    }

    cacheableTokens.add(providerToken(provider));
  }

  for (const provider of effectiveProviders.rootModuleProviders) {
    if (!isDirectSingletonContextProvider(provider)) {
      continue;
    }

    cacheableTokens.add(providerToken(provider));
  }

  return cacheableTokens;
}

/**
 * Invalidates the shell lookup cache after container-owned overrides.
 *
 * @internal
 * @param container Container owning provider resolution.
 * @param cache Shell-local eligible singleton lookup cache.
 * @param cacheableTokens Eligible direct singleton tokens.
 */
export function installContextCacheInvalidation(
  container: Container,
  cache: ContextResolutionCache,
  cacheableTokens: ContextCacheableTokens,
): void {
  const cacheInvalidatingContainer = container as CacheInvalidatingContainer;
  const override = cacheInvalidatingContainer.override.bind(container);

  cacheInvalidatingContainer.override = (...providers: Provider[]): Container => {
    const result = override(...providers);
    cache.clear();

    for (const provider of providers) {
      const token = providerToken(provider);

      if (isDirectSingletonContextProvider(provider)) {
        cacheableTokens.add(token);
      } else {
        cacheableTokens.delete(token);
      }
    }

    return result;
  };
}

/**
 * Resolves a token while memoizing only eligible direct singletons.
 *
 * @internal
 * @param container Container owning provider resolution.
 * @param token Token resolved by the owning container.
 * @param cacheableTokens Eligible direct singleton tokens.
 * @param cache Shell-local eligible singleton lookup cache.
 * @returns The container-owned resolution result.
 */
export async function resolveContextToken<T>(
  container: Container,
  token: Token<T>,
  cacheableTokens: ReadonlySet<Token>,
  cache: ContextResolutionCache,
): Promise<T> {
  if (!cacheableTokens.has(token)) {
    return container.resolve(token);
  }

  const cached = cache.get(token);

  if (cached) {
    return cached as Promise<T>;
  }

  const resolution = container.resolve(token).catch((error: unknown) => {
    cache.delete(token);
    throw error;
  });
  cache.set(token, resolution);

  return resolution;
}
