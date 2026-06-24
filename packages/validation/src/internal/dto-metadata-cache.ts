import type { Constructor, MetadataPropertyKey } from '@fluojs/core';
import {
  getClassValidationRules,
  getDtoBindingSchema,
  getDtoValidationSchema,
  type DtoFieldBindingMetadata,
  type DtoFieldValidationRule,
} from '@fluojs/core/request-pipeline';

function isClassConstructor(dto: Constructor | (() => Constructor)): dto is Constructor {
  return typeof dto === 'function' && Function.prototype.toString.call(dto).startsWith('class ');
}

export function resolveNestedDto(dto: Constructor | (() => Constructor)): Constructor {
  if (isClassConstructor(dto)) {
    return dto;
  }

  return (dto as () => Constructor)();
}

type DtoValidationSchema = ReturnType<typeof getDtoValidationSchema>;

export interface CachedDtoMetadata {
  bindingMap: Map<MetadataPropertyKey, DtoFieldBindingMetadata>;
  classValidationRules: ReturnType<typeof getClassValidationRules>;
  dtoValidationSchema: DtoValidationSchema;
  mergedPropertyKeys: Set<MetadataPropertyKey>;
  nestedDtoTransforms: readonly {
    each: boolean;
    propertyKey: MetadataPropertyKey;
    target: Constructor;
  }[];
}

const dtoMetadataCache = new WeakMap<Constructor, CachedDtoMetadata>();

function getDtoBindingMap(target: Constructor): Map<MetadataPropertyKey, DtoFieldBindingMetadata> {
  return new Map(
    getDtoBindingSchema(target).map((entry: { propertyKey: MetadataPropertyKey; metadata: DtoFieldBindingMetadata }) => [entry.propertyKey, entry.metadata]),
  );
}

function collectNestedDtoTransforms(dtoValidationSchema: DtoValidationSchema): CachedDtoMetadata['nestedDtoTransforms'] {
  const nestedEntries: CachedDtoMetadata['nestedDtoTransforms'][number][] = [];

  for (const entry of dtoValidationSchema) {
    const nestedRule = entry.rules.find(
      (rule: DtoFieldValidationRule): rule is Extract<DtoFieldValidationRule, { kind: 'nested' }> => rule.kind === 'nested',
    );

    if (!nestedRule) {
      continue;
    }

    nestedEntries.push({
      each: nestedRule.each === true,
      propertyKey: entry.propertyKey,
      target: resolveNestedDto(nestedRule.dto),
    });
  }

  return nestedEntries;
}

export function getCachedDtoMetadata(target: Constructor): CachedDtoMetadata {
  const cached = dtoMetadataCache.get(target);

  if (cached) {
    return cached;
  }

  const bindingMap = getDtoBindingMap(target);
  const dtoValidationSchema = getDtoValidationSchema(target);
  const classValidationRules = getClassValidationRules(target);
  const mergedPropertyKeys = new Set<MetadataPropertyKey>([
    ...bindingMap.keys(),
    ...dtoValidationSchema.map((entry: { propertyKey: MetadataPropertyKey }) => entry.propertyKey),
  ]);
  const nestedDtoTransforms = collectNestedDtoTransforms(dtoValidationSchema);
  const next: CachedDtoMetadata = {
    bindingMap,
    classValidationRules,
    dtoValidationSchema,
    mergedPropertyKeys,
    nestedDtoTransforms,
  };

  dtoMetadataCache.set(target, next);
  return next;
}
