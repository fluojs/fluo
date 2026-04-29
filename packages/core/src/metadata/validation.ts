import {
  appendPropertyMapValue,
  cloneMutableValue,
  getOrCreatePropertyMap,
  getStandardConstructorMetadataMap,
  getStandardMetadataBag,
  mergeMetadataPropertyKeys,
  standardMetadataKeys,
} from './shared.js';
import { createClonedWeakMapStore } from './store.js';
import type {
  ClassValidationRule,
  DtoBindingSchemaEntry,
  DtoFieldBindingMetadata,
  DtoFieldValidationRule,
  DtoValidationSchemaEntry,
  StandardDtoBindingRecord,
  StandardDtoValidationRecord,
} from './types.js';
import type { Constructor, MetadataPropertyKey } from '../types.js';

const dtoFieldBindingStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldBindingMetadata>>();
const dtoFieldValidationStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldValidationRule[]>>();
const classValidationStore = createClonedWeakMapStore<Function, ClassValidationRule[]>((rules) =>
  rules.map((rule) => cloneMutableValue(rule))
);

function getStandardDtoBindingMap(target: object): Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardDtoBindingRecord>(target, standardMetadataKeys.dtoFieldBinding);
}

function getStandardDtoValidationMap(target: object): Map<MetadataPropertyKey, StandardDtoValidationRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardDtoValidationRecord>(target, standardMetadataKeys.dtoFieldValidation);
}

function getStandardClassValidationRules(target: Function): ClassValidationRule[] | undefined {
  const rules = getStandardMetadataBag(target)?.[standardMetadataKeys.classValidation] as ClassValidationRule[] | undefined;

  return rules ? rules.map((rule) => cloneMutableValue(rule)) : undefined;
}

/**
 * Get dto field binding metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get dto field binding metadata result.
 */
export function getDtoFieldBindingMetadata(target: object, propertyKey: MetadataPropertyKey): DtoFieldBindingMetadata | undefined {
  const stored = dtoFieldBindingStore.get(target)?.get(propertyKey);
  const standard = getStandardDtoBindingMap(target)?.get(propertyKey);
  const source = stored?.source ?? standard?.source;

  if (!source) {
    return undefined;
  }

  const converter = stored?.converter ?? standard?.converter;

  return {
    ...(converter === undefined ? {} : { converter }),
    key: stored?.key ?? standard?.key,
    optional: stored?.optional ?? standard?.optional,
    source,
  };
}

/**
 * Define dto field binding metadata.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @param metadata The metadata.
 */
export function defineDtoFieldBindingMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: DtoFieldBindingMetadata,
): void {
  getOrCreatePropertyMap(dtoFieldBindingStore, target).set(propertyKey, { ...metadata });
}

/**
 * Append dto field validation rule.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @param rule The rule.
 */
export function appendDtoFieldValidationRule(
  target: object,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  appendPropertyMapValue(dtoFieldValidationStore, target, propertyKey, cloneMutableValue(rule));
}

/**
 * Append class validation rule.
 *
 * @param target The target.
 * @param rule The rule.
 */
export function appendClassValidationRule(target: Function, rule: ClassValidationRule): void {
  const rules = classValidationStore.read(target) ?? [];
  rules.push(cloneMutableValue(rule));
  classValidationStore.write(target, rules);
}

/**
 * Get dto binding schema.
 *
 * @param dto The dto.
 * @returns The get dto binding schema result.
 */
export function getDtoBindingSchema(dto: Constructor): DtoBindingSchemaEntry[] {
  const stored = dtoFieldBindingStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldBindingMetadata>();
  const standard =
    (getStandardMetadataBag(dto)?.[standardMetadataKeys.dtoFieldBinding] as Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined) ??
    new Map<MetadataPropertyKey, StandardDtoBindingRecord>();
  const keys = mergeMetadataPropertyKeys(stored, standard);

  return keys.flatMap((propertyKey) => {
    const storedEntry = stored.get(propertyKey);
    const standardEntry = standard.get(propertyKey);
    const source = storedEntry?.source ?? standardEntry?.source;

    if (!source) {
      return [];
    }

      const converter = storedEntry?.converter ?? standardEntry?.converter;

      return [
        {
          propertyKey,
          metadata: {
            ...(converter === undefined ? {} : { converter }),
            key: storedEntry?.key ?? standardEntry?.key,
            optional: storedEntry?.optional ?? standardEntry?.optional,
            source,
          },
        },
      ];
  });
}

/**
 * Get dto field validation rules.
 *
 * @param target The target.
 * @param propertyKey The property key.
 * @returns The get dto field validation rules result.
 */
export function getDtoFieldValidationRules(target: object, propertyKey: MetadataPropertyKey): readonly DtoFieldValidationRule[] {
  const stored = dtoFieldValidationStore.get(target)?.get(propertyKey) ?? [];
  const standard = getStandardDtoValidationMap(target)?.get(propertyKey) ?? [];

  return [
    ...standard.map((rule) => cloneMutableValue(rule)),
    ...stored.map((rule) => cloneMutableValue(rule)),
  ];
}

/**
 * Get dto validation schema.
 *
 * @param dto The dto.
 * @returns The get dto validation schema result.
 */
export function getDtoValidationSchema(dto: Constructor): DtoValidationSchemaEntry[] {
  const stored = dtoFieldValidationStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldValidationRule[]>();
  const standard = getStandardDtoValidationMap(dto.prototype) ?? new Map<MetadataPropertyKey, StandardDtoValidationRecord>();
  const keys = mergeMetadataPropertyKeys(stored, standard);

  return keys.flatMap((propertyKey) => {
    const rules: DtoFieldValidationRule[] = [
      ...(standard.get(propertyKey) ?? []).map((rule) => cloneMutableValue(rule)),
      ...(stored.get(propertyKey) ?? []).map((rule) => cloneMutableValue(rule)),
    ];

    if (rules.length === 0) {
      return [];
    }

    return [{ propertyKey, rules }];
  });
}

/**
 * Get class validation rules.
 *
 * @param target The target.
 * @returns The get class validation rules result.
 */
export function getClassValidationRules(target: Function): readonly ClassValidationRule[] {
  return [...(getStandardClassValidationRules(target) ?? []), ...(classValidationStore.read(target) ?? [])];
}
