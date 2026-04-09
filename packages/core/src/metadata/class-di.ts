import { createClonedWeakMapStore } from './store.js';
import type { ClassDiMetadata } from './types.js';

const classDiMetadataStore = createClonedWeakMapStore<Function, ClassDiMetadata>(cloneClassDiMetadata);

function cloneClassDiMetadata(metadata: ClassDiMetadata): ClassDiMetadata {
  return {
    inject: metadata.inject ? [...metadata.inject] : undefined,
    scope: metadata.scope,
  };
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
  classDiMetadataStore.update(target, (existing) => ({
    inject: metadata.inject !== undefined ? metadata.inject : existing?.inject,
    scope: metadata.scope ?? existing?.scope,
  }));
}

/**
 * Reads only the DI metadata defined directly on a class.
 *
 * @param target Class being inspected.
 * @returns A defensive clone of the class's own DI metadata, or `undefined` when absent.
 */
export function getOwnClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  return classDiMetadataStore.read(target);
}

/**
 * Resolves inherited DI metadata by walking the constructor lineage from base to leaf.
 *
 * @param target Class being inspected.
 * @returns The effective inherited DI metadata, or `undefined` when no lineage metadata exists.
 */
export function getInheritedClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  let effective: ClassDiMetadata | undefined;

  for (const constructor of getClassMetadataLineage(target)) {
    const metadata = classDiMetadataStore.read(constructor);

    if (!metadata) {
      continue;
    }

    effective = {
      inject: metadata.inject ?? effective?.inject,
      scope: metadata.scope ?? effective?.scope,
    };
  }

  return effective ? cloneClassDiMetadata(effective) : undefined;
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
