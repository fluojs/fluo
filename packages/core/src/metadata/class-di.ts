import type { ForwardRefToken, InjectionToken, OptionalInjectToken } from '../types.js';
import type { ClassDiMetadata } from './types.js';

const classDiMetadataStore = new WeakMap<Function, ClassDiMetadata>();
const inheritedClassDiMetadataCache = new WeakMap<Function, { metadata: ClassDiMetadata | null; version: number }>();
let classDiMetadataVersion = 0;

function isForwardRefToken(token: InjectionToken): token is ForwardRefToken {
  return typeof token === 'object' && token !== null && '__forwardRef__' in token && token.__forwardRef__ === true;
}

function isOptionalInjectToken(token: InjectionToken): token is OptionalInjectToken {
  return typeof token === 'object' && token !== null && '__optional__' in token && token.__optional__ === true;
}

function freezeInjectionToken(token: InjectionToken): InjectionToken {
  if (isForwardRefToken(token)) {
    return Object.freeze({
      __forwardRef__: true,
      forwardRef: token.forwardRef,
    });
  }

  if (isOptionalInjectToken(token)) {
    return Object.freeze({
      __optional__: true,
      token: token.token,
    });
  }

  return token;
}

function freezeInjectMetadata(inject: ClassDiMetadata['inject']): ClassDiMetadata['inject'] {
  return inject ? Object.freeze(inject.map(freezeInjectionToken)) : undefined;
}

function freezeClassDiMetadata(metadata: ClassDiMetadata): ClassDiMetadata {
  return Object.freeze({
    inject: freezeInjectMetadata(metadata.inject),
    scope: metadata.scope,
  }) as ClassDiMetadata;
}

function getClassMetadataLineage(target: Function): Function[] {
  const lineage: Function[] = [];
  let current: unknown = target;

  while (typeof current === 'function' && current !== Function.prototype) {
    lineage.push(current);
    current = Object.getPrototypeOf(current);
  }

  lineage.reverse();

  return lineage;
}

/**
 * Defines class-level DI metadata while preserving previously written fields for split decorator passes.
 *
 * @param target Class receiving DI metadata.
 * @param metadata Partial or complete DI metadata payload.
 */
export function defineClassDiMetadata(target: Function, metadata: ClassDiMetadata): void {
  const existing = classDiMetadataStore.get(target);

  classDiMetadataStore.set(target, freezeClassDiMetadata({
    inject: metadata.inject !== undefined ? metadata.inject : existing?.inject,
    scope: metadata.scope ?? existing?.scope,
  }));
  classDiMetadataVersion += 1;
}

/**
 * Reads only the DI metadata defined directly on a class.
 *
 * @param target Class being inspected.
 * @returns A frozen class DI metadata snapshot, or `undefined` when absent.
 */
export function getOwnClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  return classDiMetadataStore.get(target);
}

/**
 * Resolves inherited DI metadata by walking the constructor lineage from base to leaf.
 *
 * @param target Class being inspected.
 * @returns The effective inherited DI metadata, or `undefined` when no lineage metadata exists.
 */
export function getInheritedClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  const cached = inheritedClassDiMetadataCache.get(target);

  if (cached?.version === classDiMetadataVersion) {
    return cached.metadata ?? undefined;
  }

  let effective: ClassDiMetadata | undefined;

  for (const constructor of getClassMetadataLineage(target)) {
    const metadata = classDiMetadataStore.get(constructor);

    if (!metadata) {
      continue;
    }

    effective = freezeClassDiMetadata({
      inject: metadata.inject ?? effective?.inject,
      scope: metadata.scope ?? effective?.scope,
    });
  }

  inheritedClassDiMetadataCache.set(target, {
    metadata: effective ?? null,
    version: classDiMetadataVersion,
  });

  return effective;
}

/**
 * Reads the effective DI metadata visible to a class, including inherited fallback values.
 *
 * @param target Class being inspected.
 * @returns The effective DI metadata for the class, or `undefined` when none exists.
 */
export function getClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  return getInheritedClassDiMetadata(target);
}

/**
 * Reads the process-local class-DI metadata write version.
 *
 * @returns Monotonically increasing version bumped after each class-DI metadata write.
 */
export function getClassDiMetadataVersion(): number {
  return classDiMetadataVersion;
}
