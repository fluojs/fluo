import {
  appendPropertyMapValue,
  cloneMutableValue,
  freezeMetadataSnapshot,
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
  freezeMetadataSnapshot(rules.map((rule) => cloneMutableValue(rule)))
);

function getStandardDtoBindingMap(target: object): Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardDtoBindingRecord>(target, standardMetadataKeys.dtoFieldBinding);
}

function getStandardDtoValidationMap(target: object): Map<MetadataPropertyKey, StandardDtoValidationRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardDtoValidationRecord>(target, standardMetadataKeys.dtoFieldValidation);
}

function getStandardClassValidationRules(target: Function): ClassValidationRule[] | undefined {
  const rules = getStandardMetadataBag(target)?.[standardMetadataKeys.classValidation] as ClassValidationRule[] | undefined;

  return rules ? rules.map((rule) => cloneClassValidationRule(rule)) : undefined;
}

function cloneClassValidationRule(rule: ClassValidationRule): ClassValidationRule {
  return {
    ...(rule.code === undefined ? {} : { code: rule.code }),
    ...(rule.message === undefined ? {} : { message: rule.message }),
    validate: rule.validate,
  };
}

/**
 * Reads binding metadata for a single DTO field.
 *
 * @param target DTO prototype that owns the field metadata.
 * @param propertyKey Field property key to inspect.
 * @returns The resolved field binding metadata, or `undefined` when no source is defined.
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
 * Defines binding metadata for a DTO field.
 *
 * @param target DTO prototype receiving the field metadata.
 * @param propertyKey Field property key associated with the metadata.
 * @param metadata Binding metadata to store for the field.
 */
export function defineDtoFieldBindingMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: DtoFieldBindingMetadata,
): void {
  getOrCreatePropertyMap(dtoFieldBindingStore, target).set(propertyKey, { ...metadata });
}

/**
 * Appends a validation rule to a DTO field.
 *
 * @param target DTO prototype receiving the validation rule.
 * @param propertyKey Field property key associated with the rule.
 * @param rule Validation rule to append after existing rules.
 */
export function appendDtoFieldValidationRule(
  target: object,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  appendPropertyMapValue(dtoFieldValidationStore, target, propertyKey, cloneMutableValue(rule));
}

/**
 * Appends a class-level validation rule.
 *
 * @param target DTO class receiving the validation rule.
 * @param rule Validation rule to append after existing class-level rules.
 */
export function appendClassValidationRule(target: Function, rule: ClassValidationRule): void {
  const rules = classValidationStore.read(target) ?? [];
  classValidationStore.write(target, [...rules, cloneMutableValue(rule)]);
}

/**
 * Builds the ordered binding schema for a DTO class.
 *
 * @param dto DTO class whose prototype and standard metadata should be inspected.
 * @returns Ordered binding schema entries for fields with a defined source.
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
 * Reads validation rules for a single DTO field.
 *
 * @param target DTO prototype that owns the field metadata.
 * @param propertyKey Field property key to inspect.
 * @returns Ordered validation rules from standard metadata followed by explicit store metadata.
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
 * Builds the ordered validation schema for a DTO class.
 *
 * @param dto DTO class whose prototype and standard metadata should be inspected.
 * @returns Ordered validation schema entries for fields that have validation rules.
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
 * Reads class-level validation rules for a DTO class.
 *
 * @param target DTO class whose class-level validation rules should be inspected.
 * @returns Ordered class-level validation rules from standard metadata followed by explicit store metadata.
 */
export function getClassValidationRules(target: Function): readonly ClassValidationRule[] {
  return [
    ...(getStandardClassValidationRules(target) ?? []),
    ...(classValidationStore.read(target) ?? []).map((rule) => cloneClassValidationRule(rule)),
  ];
}
