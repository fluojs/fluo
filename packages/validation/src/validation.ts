import type {
  Constructor,
  MetadataPropertyKey,
} from '@fluojs/core';
import type { ClassValidationRule, DtoFieldBindingMetadata, DtoFieldValidationRule, ValidationIssueMetadata, ValidationRuleResult } from '@fluojs/core/internal';

import { DtoValidationError } from './errors.js';
import { getCachedDtoMetadata, resolveNestedDto } from './internal/dto-metadata-cache.js';
import { assignSafeOwnEnumerableProperties, getIterableValues, isPlainObject } from './internal/object-utils.js';
import { getRuleHandler, type NonCustomRule } from './internal/rule-handlers.js';
import type { ValidationIssue, Validator } from './types.js';

function toFieldName(propertyKey: MetadataPropertyKey): string {
  return typeof propertyKey === 'string' ? propertyKey : String(propertyKey);
}

function normalizeIssue(
  issue: ValidationIssueMetadata,
  field: string | undefined,
  source: ValidationIssue['source'],
): ValidationIssue {
  return {
    code: issue.code,
    field: issue.field ?? field,
    message: issue.message,
    source: issue.source ?? source,
  };
}

function normalizeResult(
  result: ValidationRuleResult,
  field: string | undefined,
  source: ValidationIssue['source'],
  fallback: { code: string; message: string },
): ValidationIssue[] {
  if (result === undefined || result === true) {
    return [];
  }

  if (result === false) {
    return [{ code: fallback.code, field, message: fallback.message, source }];
  }

  if (Array.isArray(result)) {
    return result.map((issue) => normalizeIssue(issue, field, source));
  }

  return [normalizeIssue(result as ValidationIssueMetadata, field, source)];
}

function joinFieldPath(parent: string, child?: string): string {
  if (!child) return parent;
  return child.startsWith('[') ? `${parent}${child}` : `${parent}.${child}`;
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  fieldPrefix: string,
  source: ValidationIssue['source'],
): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, field: joinFieldPath(fieldPrefix, issue.field), source: issue.source ?? source }));
}

interface NestedTraversalContext {
  readonly active: WeakSet<object>;
}

interface ValidationContext {
  readonly fieldPrefix?: string;
  readonly inheritedSource?: ValidationIssue['source'];
}

function enterTraversal(value: unknown, context?: NestedTraversalContext): boolean {
  if (!context || typeof value !== 'object' || value === null) {
    return true;
  }

  if (context.active.has(value)) {
    return false;
  }

  context.active.add(value);
  return true;
}

function exitTraversal(value: unknown, context?: NestedTraversalContext): void {
  if (!context || typeof value !== 'object' || value === null) {
    return;
  }

  context.active.delete(value);
}

function createNestedDtoInstance<T>(target: Constructor<T>, rawValue: unknown, context?: NestedTraversalContext): T {
  if (rawValue instanceof target) {
    return rawValue as T;
  }

  if (!isPlainObject(rawValue)) {
    return rawValue as T;
  }

  const instance = new target() as Record<PropertyKey, unknown>;

  if (!enterTraversal(rawValue, context)) {
    return rawValue as T;
  }

  try {
    assignSafeOwnEnumerableProperties(instance, rawValue);

    const metadata = getCachedDtoMetadata(target);
    applyBindingValues(instance, rawValue, metadata.mergedPropertyKeys, metadata.bindingMap);

    for (const nestedEntry of metadata.nestedDtoTransforms) {
      const currentValue = instance[nestedEntry.propertyKey];
      if (currentValue === undefined || currentValue === null) {
        continue;
      }

      instance[nestedEntry.propertyKey] = nestedEntry.each
        ? transformNestedEachValue(currentValue, nestedEntry.target, context)
        : transformNestedValue(currentValue, nestedEntry.target, context);
    }

    return instance as T;
  } finally {
    exitTraversal(rawValue, context);
  }
}

function materializeNestedDtoValue<T>(target: Constructor<T>, rawValue: unknown, context?: NestedTraversalContext): unknown {
  if (rawValue instanceof target) {
    return rawValue;
  }

  if (!isPlainObject(rawValue)) {
    return rawValue;
  }

  return createNestedDtoInstance(target, rawValue, context);
}

function applyBindingValues(
  instance: Record<PropertyKey, unknown>,
  rawValue: Record<PropertyKey, unknown>,
  keys: Set<MetadataPropertyKey>,
  bindingMap: Map<MetadataPropertyKey, DtoFieldBindingMetadata>,
): void {
  for (const propertyKey of keys) {
    const sourceKey = bindingMap.get(propertyKey)?.key;
    if (!sourceKey) continue;
    instance[propertyKey] = rawValue[sourceKey];
  }
}

function transformNestedValue(value: unknown, target: Constructor, context?: NestedTraversalContext): unknown {
  return value === undefined || value === null ? value : materializeNestedDtoValue(target, value, context);
}

function transformNestedEachValue(value: unknown, target: Constructor, context?: NestedTraversalContext): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformNestedValue(item, target, context));
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (item) => transformNestedValue(item, target, context)));
  }

  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, item]) => [key, transformNestedValue(item, target, context)]));
  }

  return transformNestedValue(value, target, context);
}

function describeValidator(rule: DtoFieldValidationRule, field: string): { code: string; message: string } {
  const handler = getRuleHandler(rule);

  return {
    code: rule.code ?? (rule.kind === 'validatorjs' ? rule.validator.toUpperCase() : handler.defaultCode),
    message: rule.message ?? handler.describe(field, rule),
  };
}

function buildIssue(fallback: { code: string; message: string }, field: string, source: ValidationIssue['source']): ValidationIssue {
  return {
    code: fallback.code,
    field,
    message: fallback.message,
    source,
  };
}

function buildInvalidRootIssue(): ValidationIssue {
  return {
    code: 'INVALID_DTO',
    message: 'DTO root value must be a plain object.',
  };
}

function assertValidRootValue(value: unknown, target: Constructor): void {
  if (value instanceof target || isPlainObject(value)) {
    return;
  }

  throw new DtoValidationError('Validation failed.', [buildInvalidRootIssue()]);
}

function getRuleValues(value: unknown): unknown[] {
  return getIterableValues(value) ?? [value];
}

function shouldSkipRuleForMissingValue(rule: DtoFieldValidationRule, value: unknown): boolean {
  return (value === undefined || value === null) && rule.kind !== 'defined' && rule.kind !== 'notEmpty' && rule.kind !== 'empty';
}

async function evaluateCustomRule(
  rule: Extract<DtoFieldValidationRule, { kind: 'custom' }>,
  value: unknown,
  dto: unknown,
  propertyKey: MetadataPropertyKey,
  fieldPath: string,
  source: ValidationIssue['source'],
  fallback: { code: string; message: string },
): Promise<ValidationIssue[]> {
  if (!rule.each) {
    return normalizeResult(await rule.validate(value, { dto, propertyKey }), fieldPath, rule.source ?? source, fallback);
  }

  const issues: ValidationIssue[] = [];

  for (const [index, entry] of getRuleValues(value).entries()) {
    const result = await rule.validate(entry, { dto, propertyKey });
    issues.push(
      ...prefixIssues(
        normalizeResult(result, undefined, rule.source ?? source, fallback),
        `${fieldPath}[${String(index)}]`,
        source,
      ),
    );
  }

  return issues;
}

function validateSingleRule(rule: DtoFieldValidationRule, value: unknown): boolean {
  if (rule.kind === 'custom' || rule.kind === 'nested') {
    return true;
  }

  return runRulePredicate(rule, value);
}

function runRulePredicate<K extends NonCustomRule['kind']>(
  rule: Extract<NonCustomRule, { kind: K }>,
  value: unknown,
): boolean {
  return getRuleHandler(rule).validate(rule, value);
}

async function validateNestedRule(
  rule: Extract<DtoFieldValidationRule, { kind: 'nested' }>,
  value: unknown,
  fieldPath: string,
  inheritedSource: ValidationIssue['source'],
  context: NestedTraversalContext,
): Promise<ValidationIssue[]> {
  const values = rule.each ? getIterableValues(value) ?? [value] : [value];
  const issues: ValidationIssue[] = [];
  const resolvedDto = resolveNestedDto(rule.dto);

  for (const [index, entry] of values.entries()) {
    if (entry === undefined || entry === null) continue;
    const nestedPath = rule.each ? `${fieldPath}[${String(index)}]` : fieldPath;
    const trackedEntry = typeof entry === 'object' && entry !== null ? entry : undefined;

    if (!(entry instanceof resolvedDto) && !isPlainObject(entry)) {
      issues.push(buildIssue(describeValidator(rule, nestedPath), nestedPath, inheritedSource));
      continue;
    }

    if (trackedEntry && context.active.has(trackedEntry)) {
      issues.push(buildIssue(describeValidator(rule, nestedPath), nestedPath, inheritedSource));
      continue;
    }

    const nestedDto = createNestedDtoInstance(resolvedDto, entry, context);
    const shouldTrackEntry = trackedEntry && !(entry instanceof resolvedDto)
      ? enterTraversal(trackedEntry, context)
      : false;

    try {
      issues.push(...(await collectValidationIssuesInternal(resolvedDto, nestedDto, { fieldPrefix: nestedPath, inheritedSource }, context)));
    } finally {
      if (trackedEntry && shouldTrackEntry) {
        exitTraversal(trackedEntry, context);
      }
    }
  }

  return issues;
}

async function evaluateRule(
  rule: DtoFieldValidationRule,
  value: unknown,
  dto: unknown,
  propertyKey: MetadataPropertyKey,
  fieldPath: string,
  source: ValidationIssue['source'],
  context: NestedTraversalContext,
): Promise<ValidationIssue[]> {
  const fallback = describeValidator(rule, fieldPath);

  if (rule.kind === 'custom') {
    return evaluateCustomRule(rule, value, dto, propertyKey, fieldPath, source, fallback);
  }

  if (rule.kind === 'nested') {
    return validateNestedRule(rule, value, fieldPath, source, context);
  }

  if (rule.each) {
    const issues: ValidationIssue[] = [];

    for (const [index, entry] of getRuleValues(value).entries()) {
      if (!validateSingleRule(rule, entry)) {
        issues.push(buildIssue(fallback, `${fieldPath}[${String(index)}]`, source));
      }
    }

    return issues;
  }

  if (!validateSingleRule(rule, value)) {
    return [buildIssue(fallback, fieldPath, source)];
  }

  return [];
}

async function applyPropertyRules(
  rules: readonly DtoFieldValidationRule[],
  value: unknown,
  dto: unknown,
  propertyKey: MetadataPropertyKey,
  fieldPath: string,
  source: ValidationIssue['source'],
  context: NestedTraversalContext,
): Promise<ValidationIssue[]> {
  const conditionallySkip = await shouldConditionallySkip(rules, dto, value);

  if (rules.some((rule) => rule.kind === 'optional') && (value === undefined || value === null)) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    if (rule.kind === 'validateIf' || rule.kind === 'optional') continue;
    if (conditionallySkip) continue;
    if (shouldSkipRuleForMissingValue(rule, value)) continue;
    issues.push(...(await evaluateRule(rule, value, dto, propertyKey, fieldPath, source, context)));
  }

  return issues;
}

async function validateClassRule(rule: ClassValidationRule, dto: unknown): Promise<ValidationIssue[]> {
  return normalizeResult(await rule.validate(dto), undefined, undefined, {
    code: rule.code ?? 'INVALID_DTO',
    message: rule.message ?? 'DTO validation failed.',
  });
}

async function shouldConditionallySkip(
  rules: readonly DtoFieldValidationRule[],
  dto: unknown,
  value: unknown,
): Promise<boolean> {
  for (const rule of rules) {
    if (rule.kind === 'validateIf' && !(await rule.validateIf(dto, value))) {
      return true;
    }
  }

  return false;
}

async function collectValidationIssues<T>(target: Constructor<T>, value: T): Promise<readonly ValidationIssue[]> {
  return collectValidationIssuesInternal(target, value, {}, { active: new WeakSet<object>() });
}

async function collectValidationIssuesInternal<T>(
  target: Constructor<T>,
  value: T,
  context: ValidationContext,
  traversal: NestedTraversalContext,
): Promise<readonly ValidationIssue[]> {
  if (!enterTraversal(value, traversal)) {
    return [];
  }

  try {
    const metadata = getCachedDtoMetadata(target);
    const issues: ValidationIssue[] = [];

    for (const entry of metadata.dtoValidationSchema) {
      const fieldValue = (value as Record<PropertyKey, unknown>)[entry.propertyKey];
      const source = metadata.bindingMap.get(entry.propertyKey)?.source ?? context.inheritedSource;
      const fieldPath = context.fieldPrefix ? joinFieldPath(context.fieldPrefix, toFieldName(entry.propertyKey)) : toFieldName(entry.propertyKey);
      issues.push(...(await applyPropertyRules(entry.rules, fieldValue, value, entry.propertyKey, fieldPath, source, traversal)));
    }

    for (const rule of metadata.classValidationRules) {
      const classIssues = await validateClassRule(rule, value);
      issues.push(...(context.fieldPrefix ? prefixIssues(classIssues, context.fieldPrefix, context.inheritedSource) : classIssues));
    }

    return issues;
  } finally {
    exitTraversal(value, traversal);
  }
}

/**
 * Represents the default validator.
 */
export class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void> {
    assertValidRootValue(value, target);

    const issues = await collectValidationIssues(target, value);
    if (issues.length === 0) return;
    throw new DtoValidationError('Validation failed.', issues);
  }

  async materialize<T>(value: unknown, target: Constructor<T>): Promise<T> {
    assertValidRootValue(value, target);

    const instance = createNestedDtoInstance(target, value, { active: new WeakSet<object>() });
    const issues = await collectValidationIssues(target, instance);

    if (issues.length > 0) {
      throw new DtoValidationError('Validation failed.', issues);
    }

    return instance as T;
  }
}
