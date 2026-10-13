import type { Provider, Scope } from '@fluojs/di';

import { getRuntimeClassDiMetadata } from './core-metadata.js';

// Declaration policy, not DI resolution: aliases retain singleton diagnostics
// even when the target's actual lifetime is request or transient.
/**
 * Projects the authored provider strategy for diagnostics.
 *
 * @internal
 * @param provider Authored provider declaration.
 * @returns The diagnostic provider strategy.
 */
export function providerShape(provider: Provider): 'class' | 'factory' | 'value' | 'existing' {
  if (typeof provider === 'function') {
    return 'class';
  }

  if ('useFactory' in provider) {
    return 'factory';
  }

  if ('useValue' in provider) {
    return 'value';
  }

  if ('useExisting' in provider) {
    return 'existing';
  }

  return 'class';
}

/**
 * Reads declaration scope without following alias targets.
 *
 * @internal
 * @param provider Authored provider declaration.
 * @returns The declaration scope; alias and value diagnostics remain singleton.
 */
export function providerScope(provider: Provider): Scope {
  if (typeof provider === 'function') {
    return getRuntimeClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useValue' in provider || 'useExisting' in provider) {
    return 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? (provider.resolverClass ? getRuntimeClassDiMetadata(provider.resolverClass)?.scope : undefined) ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getRuntimeClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'singleton';
}


/**
 * Identifies an ordered multi-provider declaration.
 *
 * @internal
 * @param provider Authored provider declaration.
 * @returns Whether the declaration contributes to a multi token.
 */
export function isMultiProvider(provider: Provider): boolean {
  return typeof provider === 'object'
    && provider !== null
    && 'multi' in provider
    && provider.multi === true;
}

/**
 * Selects direct singleton class/factory declarations without caching aliases or values.
 *
 * @internal
 * @param provider Authored provider declaration.
 * @param includeMulti Whether individual multi contributions may participate.
 * @returns Whether the declaration is eligible.
 */
export function isDirectSingletonContextProvider(provider: Provider, includeMulti = false): boolean {
  if (isMultiProvider(provider) && !includeMulti) {
    return false;
  }

  if (typeof provider === 'function') {
    return providerScope(provider) === 'singleton';
  }

  if ('useExisting' in provider || 'useValue' in provider) {
    return false;
  }

  return providerScope(provider) === 'singleton';
}
