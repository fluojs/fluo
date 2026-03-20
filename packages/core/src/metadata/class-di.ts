import type { ClassDiMetadata } from './types.js';

const classDiMetadataStore = new WeakMap<Function, ClassDiMetadata>();

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
    lineage.unshift(current);
    current = Object.getPrototypeOf(current);
  }

  return lineage;
}

export function defineClassDiMetadata(target: Function, metadata: ClassDiMetadata): void {
  const existing = classDiMetadataStore.get(target);

  classDiMetadataStore.set(
    target,
    cloneClassDiMetadata({
      inject: metadata.inject ?? existing?.inject,
      scope: metadata.scope ?? existing?.scope,
    }),
  );
}

export function getOwnClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  const metadata = classDiMetadataStore.get(target);

  return metadata ? cloneClassDiMetadata(metadata) : undefined;
}

export function getInheritedClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  let effective: ClassDiMetadata | undefined;

  for (const constructor of getClassMetadataLineage(target)) {
    const metadata = classDiMetadataStore.get(constructor);

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
