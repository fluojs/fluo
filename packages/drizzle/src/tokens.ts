import type { Token } from '@fluojs/core';

import { normalizeDrizzleRegistrationName } from './registration-name.js';

/** Dependency-injection token for the raw Drizzle database handle. */
export const DRIZZLE_DATABASE = Symbol.for('fluo.drizzle.database');
/** Dependency-injection token for the lifecycle-aware Drizzle database wrapper. */
export const DRIZZLE_HANDLE_PROVIDER = Symbol.for('fluo.drizzle.handle-provider');
/** Dependency-injection token for the optional Drizzle shutdown dispose hook. */
export const DRIZZLE_DISPOSE = Symbol.for('fluo.drizzle.dispose');
/** Dependency-injection token for normalized Drizzle runtime options. */
export const DRIZZLE_OPTIONS = Symbol.for('fluo.drizzle.options');

/**
 * Returns the DI token for the raw Drizzle database bound to a registration name.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Drizzle registration.
 * @returns The token that resolves the matching raw Drizzle database handle.
 */
export function getDrizzleDatabaseToken(name?: string): Token {
  const normalizedName = normalizeDrizzleRegistrationName(name);

  return normalizedName === undefined
    ? DRIZZLE_DATABASE
    : Symbol.for(`fluo.drizzle.database:${normalizedName}`);
}

/**
 * Returns the DI token for the optional Drizzle disposal hook bound to a registration name.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Drizzle registration.
 * @returns The token that resolves the matching optional disposal hook.
 */
export function getDrizzleDisposeToken(name?: string): Token {
  const normalizedName = normalizeDrizzleRegistrationName(name);

  return normalizedName === undefined
    ? DRIZZLE_DISPOSE
    : Symbol.for(`fluo.drizzle.dispose:${normalizedName}`);
}

/**
 * Returns the DI token for the lifecycle-aware Drizzle handle bound to a registration name.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Drizzle registration.
 * @returns The token that resolves the matching lifecycle-aware Drizzle handle.
 */
export function getDrizzleHandleProviderToken(name?: string): Token {
  const normalizedName = normalizeDrizzleRegistrationName(name);

  return normalizedName === undefined
    ? DRIZZLE_HANDLE_PROVIDER
    : Symbol.for(`fluo.drizzle.handle-provider:${normalizedName}`);
}

/**
 * Returns the DI token for normalized Drizzle runtime options bound to a registration name.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Drizzle registration.
 * @returns The token that resolves the matching normalized runtime options.
 */
export function getDrizzleOptionsToken(name?: string): Token {
  const normalizedName = normalizeDrizzleRegistrationName(name);

  return normalizedName === undefined
    ? DRIZZLE_OPTIONS
    : Symbol.for(`fluo.drizzle.options:${normalizedName}`);
}
