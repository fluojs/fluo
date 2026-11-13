import type { Constructor, MetadataPropertyKey } from '../types.js';
import {
  appendPropertyMapValue,
  cloneMutableValue,
  getGlobalMetadataWeakMap,
  getOrCreatePropertyMap,
  getStandardConstructorMetadataMap,
  getStandardMetadataBag,
  mergeMetadataPropertyKeys,
  metadataKeys,
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

const dtoFieldBindingStore = getGlobalMetadataWeakMap<object, Map<MetadataPropertyKey, DtoFieldBindingMetadata>>(metadataKeys.dtoFieldBinding);
const dtoFieldValidationStore = getGlobalMetadataWeakMap<object, Map<MetadataPropertyKey, DtoFieldValidationRule[]>>(metadataKeys.dtoFieldValidation);
const classValidationStore = createClonedWeakMapStore<Function, ClassValidationRule[]>(
  (rules) => rules.map((rule) => cloneMutableValue(rule)),
  getGlobalMetadataWeakMap<Function, ClassValidationRule[]>(metadataKeys.classValidation),
);

function getInheritedTargets(target: object): object[] {
  const targets: object[] = [];
  let current: object | null = target;

  while (current && current !== Object.prototype) {
    targets.unshift(current);
    current = Object.getPrototypeOf(current) as object | null;
  }

  return targets;
}

function getInheritedConstructors(target: Function): Function[] {
  const targets: Function[] = [];
  let current: Function | null = target;

  while (current && current !== Function.prototype) {
    targets.unshift(current);
    current = Object.getPrototypeOf(current) as Function | null;
  }

  return targets;
}

function getInheritedStoredDtoBindingMap(target: object): Map<MetadataPropertyKey, DtoFieldBindingMetadata> {
  const merged = new Map<MetadataPropertyKey, DtoFieldBindingMetadata>();

  for (const current of getInheritedTargets(target)) {
    const stored = dtoFieldBindingStore.get(current);

    if (!stored) {
      continue;
    }

    for (const [propertyKey, metadata] of stored) {
      merged.set(propertyKey, cloneMutableValue(metadata));
    }
  }

  return merged;
}

function getInheritedStoredDtoValidationMap(target: object): Map<MetadataPropertyKey, DtoFieldValidationRule[]> {
  const merged = new Map<MetadataPropertyKey, DtoFieldValidationRule[]>();

  for (const current of getInheritedTargets(target)) {
    const stored = dtoFieldValidationStore.get(current);

    if (!stored) {
      continue;
    }

    for (const [propertyKey, rules] of stored) {
      const existing = merged.get(propertyKey) ?? [];
      merged.set(propertyKey, [
        ...existing,
        ...rules.map((rule) => cloneMutableValue(rule)),
      ]);
    }
  }

  return merged;
}

function getInheritedStoredClassValidationRules(target: Function): ClassValidationRule[] {
  return getInheritedConstructors(target).flatMap((current) => classValidationStore.read(current) ?? []);
}

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
 * Resolve one field's binding from inherited stored maps and standard metadata.
 * Stored maps are collected base-to-leaf, with each leaf entry replacing the base entry.
 * Non-nullish stored fields override standard fields. An undefined converter is omitted.
 *
 * @param target Object whose prototype chain supplies stored binding maps.
 * @param propertyKey DTO field whose binding is resolved.
 * @returns A fresh mutable binding record, or undefined when no source is resolved.
 */
export function getDtoFieldBindingMetadata(target: object, propertyKey: MetadataPropertyKey): DtoFieldBindingMetadata | undefined {
  const stored = getInheritedStoredDtoBindingMap(target).get(propertyKey);
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
 * Shallow-copy and replace one field binding in the target's own stored map.
 *
 * @param target Object whose own binding map receives the entry.
 * @param propertyKey DTO field whose previous stored binding is replaced.
 * @param metadata Binding record to shallow-copy into the store.
 */
export function defineDtoFieldBindingMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: DtoFieldBindingMetadata,
): void {
  getOrCreatePropertyMap(dtoFieldBindingStore, target).set(propertyKey, { ...metadata });
}

/**
 * Clone and append a field validation rule to the target's own list.
 * Existing rules are retained in order, without deduplication.
 *
 * @param target Object whose own field-rule map receives the rule.
 * @param propertyKey DTO field whose stored rule list is extended.
 * @param rule Validation rule to clone before appending.
 */
export function appendDtoFieldValidationRule(
  target: object,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  appendPropertyMapValue(dtoFieldValidationStore, target, propertyKey, cloneMutableValue(rule));
}

/**
 * Clone and append a class validation rule to the target's own list.
 * Existing rules are retained in order, without inheriting or deduplicating them on write.
 *
 * @param target DTO constructor whose own stored rule list is extended.
 * @param rule Class validation rule to clone before appending.
 */
export function appendClassValidationRule(target: Function, rule: ClassValidationRule): void {
  const rules = classValidationStore.read(target) ?? [];
  rules.push(cloneMutableValue(rule));
  classValidationStore.write(target, rules);
}

/**
 * Resolve DTO bindings in stored-key-first order, followed by standard-only keys.
 * Stored maps are collected along the prototype chain base-to-leaf, with leaf entries
 * replacing base entries. Non-nullish stored fields override standard fields.
 * Entries without a source are skipped, and undefined converters are omitted.
 *
 * @param dto DTO constructor whose prototype supplies inherited stored bindings.
 * @returns A fresh mutable schema with newly created binding entries.
 */
export function getDtoBindingSchema(dto: Constructor): DtoBindingSchemaEntry[] {
  const stored = getInheritedStoredDtoBindingMap(dto.prototype);
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
 * Collect cloned field rules standard-first, then inherited stored rules base-to-leaf.
 * Stored maps are read along the target's prototype chain; rules are not deduplicated.
 *
 * @param target Object whose prototype chain supplies stored validation maps.
 * @param propertyKey DTO field whose validation rules are collected.
 * @returns A fresh array of cloned rules, empty when neither source provides rules.
 */
export function getDtoFieldValidationRules(target: object, propertyKey: MetadataPropertyKey): readonly DtoFieldValidationRule[] {
  const stored = getInheritedStoredDtoValidationMap(target).get(propertyKey) ?? [];
  const standard = getStandardDtoValidationMap(target)?.get(propertyKey) ?? [];

  return [
    ...standard.map((rule) => cloneMutableValue(rule)),
    ...stored.map((rule) => cloneMutableValue(rule)),
  ];
}

/**
 * Collect field-rule entries in stored-key-first order, followed by standard-only keys.
 * For each field, cloned standard rules precede inherited stored rules collected
 * along the prototype chain base-to-leaf, without deduplication. Empty rule lists are skipped.
 *
 * @param dto DTO constructor whose prototype supplies stored and standard field rules.
 * @returns A fresh mutable schema containing cloned validation rules.
 */
export function getDtoValidationSchema(dto: Constructor): DtoValidationSchemaEntry[] {
  const stored = getInheritedStoredDtoValidationMap(dto.prototype);
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
 * Collect cloned class rules standard-first, then inherited stored rules base-to-leaf.
 * Stored lists are read along the constructor prototype chain, without deduplication.
 *
 * @param target DTO constructor whose class validation rules are collected.
 * @returns A fresh array of cloned rules, empty when neither source provides rules.
 */
export function getClassValidationRules(target: Function): readonly ClassValidationRule[] {
  return [...(getStandardClassValidationRules(target) ?? []), ...getInheritedStoredClassValidationRules(target)];
}
