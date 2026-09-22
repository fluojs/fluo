import type { Token } from '../types.js';
import { getGlobalMetadataCounter, getGlobalMetadataWeakMap } from './shared.js';

/**
 * Internal compatibility identity for one framework-owned, publicly injectable service class.
 *
 * The identity is deliberately attached only through this internal writer. Application classes
 * retain ordinary constructor identity even when their names or source shapes match.
 */
export interface FrameworkServiceIdentity {
  readonly id: string;
  readonly version: number;
}

const frameworkServiceIdentityStore = getGlobalMetadataWeakMap<Function, FrameworkServiceIdentity>(
  Symbol.for('fluo.metadata.framework-service-identity'),
);
const frameworkServiceIdentityVersion = getGlobalMetadataCounter(
  Symbol.for('fluo.metadata.version.framework-service-identity'),
);

function validateIdentity(identity: FrameworkServiceIdentity): void {
  if (identity.id.length === 0) {
    throw new TypeError('Framework service identity id must not be empty.');
  }

  if (!Number.isSafeInteger(identity.version) || identity.version < 1) {
    throw new TypeError('Framework service identity version must be a positive safe integer.');
  }
}

/**
 * Explicitly marks a framework-owned public service constructor as compatible across copies.
 *
 * @param target Framework-owned public service constructor.
 * @param identity Versioned contract identity shared by compatible copies.
 * @internal
 */
export function defineFrameworkServiceIdentity(target: Function, identity: FrameworkServiceIdentity): void {
  validateIdentity(identity);
  frameworkServiceIdentityStore.set(target, Object.freeze({ ...identity }));
  frameworkServiceIdentityVersion.value += 1;
}

/**
 * Declares a framework-owned public service class compatible across matching copies.
 *
 * @param identity Versioned contract identity shared by compatible copies.
 * @returns A class decorator that records the explicit service identity.
 * @internal
 */
export function FrameworkService(identity: FrameworkServiceIdentity): ClassDecorator {
  validateIdentity(identity);
  return (target) => defineFrameworkServiceIdentity(target, identity);
}

/**
 * Reads the explicit compatible-copy service identity for one constructor.
 *
 * @param target Constructor to inspect.
 * @returns The explicit identity, when the constructor is designated.
 * @internal
 */
export function getFrameworkServiceIdentity(target: Function): FrameworkServiceIdentity | undefined {
  return frameworkServiceIdentityStore.get(target);
}

/**
 * Reads the current service-identity metadata version for dependent cache invalidation.
 *
 * @returns Monotonic identity metadata write version.
 * @internal
 */
export function getFrameworkServiceIdentityVersion(): number {
  return frameworkServiceIdentityVersion.value;
}

/**
 * Replaces only explicitly designated framework service constructors with an internal stable token.
 *
 * @param token DI token to canonicalize.
 * @returns Internal stable token for a designated framework service, otherwise the original token.
 * @internal
 */
export function normalizeFrameworkServiceToken<T>(token: Token<T>): Token<T> {
  if (typeof token !== 'function') {
    return token;
  }

  const identity = getFrameworkServiceIdentity(token);

  if (!identity) {
    return token;
  }

  return Symbol.for(`fluo.framework-service/${identity.id}/v${String(identity.version)}`) as Token<T>;
}
