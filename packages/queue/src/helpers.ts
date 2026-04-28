import { type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { Provider } from '@fluojs/di';
import type { CompiledModule } from '@fluojs/runtime';

import type { QueueRateLimiterOptions } from './types.js';

/**
 * Defines the scope type.
 */
export type Scope = 'request' | 'singleton' | 'transient';

/**
 * Describes the discovery candidate contract.
 */
export interface DiscoveryCandidate {
  moduleName: string;
  scope: Scope;
  targetType: Function;
  token: Token;
}

/**
 * Scope from provider.
 *
 * @param provider The provider.
 * @returns The scope from provider result.
 */
export function scopeFromProvider(provider: Provider): Scope {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

/**
 * Is class provider.
 *
 * @param provider The provider.
 * @returns The is class provider result.
 */
export function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

/**
 * Collect discovery candidates.
 *
 * @param compiledModules The compiled modules.
 * @returns The collect discovery candidates result.
 */
export function collectDiscoveryCandidates(compiledModules: readonly CompiledModule[]): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  for (const compiledModule of compiledModules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      if (typeof provider === 'function') {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(provider),
          targetType: provider,
          token: provider,
        });
        continue;
      }

      if (isClassProvider(provider)) {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(provider),
          targetType: provider.useClass,
          token: provider.provide,
        });
      }
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      candidates.push({
        moduleName: compiledModule.type.name,
        scope: scopeFromProvider(controller),
        targetType: controller,
        token: controller,
      });
    }
  }

  return candidates;
}

/**
 * Normalize positive integer.
 *
 * @param value The value.
 * @param fallback The fallback.
 * @returns The normalize positive integer result.
 */
export function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);

  if (normalized < 1) {
    return fallback;
  }

  return normalized;
}

/**
 * Normalize positive integer or false.
 *
 * @param value The value.
 * @param fallback The fallback.
 * @returns The normalize positive integer or false result.
 */
export function normalizePositiveIntegerOrFalse(
  value: number | false | undefined,
  fallback: number | false,
): number | false {
  if (value === false) {
    return false;
  }

  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);

  if (normalized < 1) {
    return fallback;
  }

  return normalized;
}

/**
 * Normalize rate limiter.
 *
 * @param rateLimiter The rate limiter.
 * @returns The normalize rate limiter result.
 */
export function normalizeRateLimiter(rateLimiter: QueueRateLimiterOptions | undefined): QueueRateLimiterOptions | undefined {
  if (!rateLimiter) {
    return undefined;
  }

  return {
    duration: normalizePositiveInteger(rateLimiter.duration, 1_000),
    max: normalizePositiveInteger(rateLimiter.max, 1),
  };
}

/**
 * With timeout.
 *
 * @param promise The promise.
 * @param timeoutMs The timeout ms.
 * @param timeoutErrorFactory The timeout error factory.
 * @returns The with timeout result.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutErrorFactory: () => Error,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(timeoutErrorFactory());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
