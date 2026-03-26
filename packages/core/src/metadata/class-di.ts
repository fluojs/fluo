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

export function defineClassDiMetadata(target: Function, metadata: ClassDiMetadata): void {
  const existing = classDiMetadataStore.read(target);

  classDiMetadataStore.write(
    target,
    {
      inject: metadata.inject !== undefined ? metadata.inject : existing?.inject,
      scope: metadata.scope ?? existing?.scope,
    },
  );
}

export function getOwnClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  return classDiMetadataStore.read(target);
}

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

export function getClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  return getInheritedClassDiMetadata(target);
}
