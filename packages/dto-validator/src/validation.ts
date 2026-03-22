import validator from 'validator';

import {
  getClassValidationRules,
  getDtoBindingSchema,
  getDtoValidationSchema,
  type ClassValidationRule,
  type Constructor,
  type DtoFieldBindingMetadata,
  type DtoFieldValidationRule,
  type MetadataPropertyKey,
  type ValidationIssueMetadata,
  type ValidationRuleResult,
} from '@konekti/core';

import { DtoValidationError } from './errors.js';
import type { ValidationIssue, Validator } from './types.js';

function resolveNestedDto(dto: Constructor | (() => Constructor)): Constructor {
  if (typeof dto === 'function' && 'prototype' in dto && dto.prototype) {
    return dto as Constructor;
  }

  return (dto as () => Constructor)();
}

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

function getIterableValues(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value.values());
  if (value instanceof Map) return Array.from(value.values());
  return undefined;
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
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

type RuleKind = DtoFieldValidationRule['kind'];
type NonCustomRule = Exclude<DtoFieldValidationRule, { kind: 'custom' | 'nested' }>;
type DtoValidationSchema = ReturnType<typeof getDtoValidationSchema>;

interface CachedDtoMetadata {
  bindingMap: Map<MetadataPropertyKey, DtoFieldBindingMetadata>;
  classValidationRules: ReturnType<typeof getClassValidationRules>;
  dtoValidationSchema: DtoValidationSchema;
  mergedPropertyKeys: Set<MetadataPropertyKey>;
}

const dtoMetadataCache = new WeakMap<Constructor, CachedDtoMetadata>();

function getCachedDtoMetadata(target: Constructor): CachedDtoMetadata {
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
  const next: CachedDtoMetadata = {
    bindingMap,
    classValidationRules,
    dtoValidationSchema,
    mergedPropertyKeys,
  };

  dtoMetadataCache.set(target, next);
  return next;
}

type RuleHandler<K extends RuleKind> = {
  defaultCode: string;
  describe: (field: string, rule: Extract<DtoFieldValidationRule, { kind: K }>) => string;
  validate: (rule: Extract<DtoFieldValidationRule, { kind: K }>, value: unknown) => boolean;
};

function getRuleHandler<K extends RuleKind>(rule: Extract<DtoFieldValidationRule, { kind: K }>): RuleHandler<K> {
  return RULE_HANDLERS[rule.kind] as RuleHandler<K>;
}

const RULE_HANDLERS: { [K in RuleKind]: RuleHandler<K> } = {
  validateIf: {
    defaultCode: 'VALIDATE_IF',
    describe: (field) => `${field} is conditionally invalid.`,
    validate: () => true,
  },
  defined: {
    defaultCode: 'REQUIRED',
    describe: (field) => `${field} is required.`,
    validate: () => true,
  },
  optional: {
    defaultCode: 'OPTIONAL',
    describe: (field) => `${field} is optional.`,
    validate: () => true,
  },
  equals: {
    defaultCode: 'EQUALS',
    describe: (field, rule) => `${field} must equal ${String(rule.value)}.`,
    validate: (rule, value) => value === rule.value,
  },
  notEquals: {
    defaultCode: 'NOT_EQUALS',
    describe: (field, rule) => `${field} must not equal ${String(rule.value)}.`,
    validate: (rule, value) => value !== rule.value,
  },
  empty: {
    defaultCode: 'EMPTY',
    describe: (field) => `${field} must be empty.`,
    validate: (_rule, value) => isEmptyValue(value),
  },
  notEmpty: {
    defaultCode: 'NOT_EMPTY',
    describe: (field) => `${field} should not be empty.`,
    validate: (_rule, value) => !isEmptyValue(value),
  },
  in: {
    defaultCode: 'IN',
    describe: (field) => `${field} must be one of the allowed values.`,
    validate: (rule, value) => rule.values.includes(value),
  },
  notIn: {
    defaultCode: 'NOT_IN',
    describe: (field) => `${field} contains a forbidden value.`,
    validate: (rule, value) => !rule.values.includes(value),
  },
  string: {
    defaultCode: 'INVALID_STRING',
    describe: (field) => `${field} must be a string.`,
    validate: (_rule, value) => typeof value === 'string',
  },
  number: {
    defaultCode: 'INVALID_NUMBER',
    describe: (field) => `${field} must be a number.`,
    validate: (rule, value) => typeof value === 'number' && (rule.allowNaN || !Number.isNaN(value)),
  },
  boolean: {
    defaultCode: 'INVALID_BOOLEAN',
    describe: (field) => `${field} must be a boolean.`,
    validate: (_rule, value) => typeof value === 'boolean',
  },
  date: {
    defaultCode: 'INVALID_DATE',
    describe: (field) => `${field} must be a Date instance.`,
    validate: (_rule, value) => value instanceof Date && !Number.isNaN(value.getTime()),
  },
  array: {
    defaultCode: 'INVALID_ARRAY',
    describe: (field) => `${field} must be an array.`,
    validate: (_rule, value) => Array.isArray(value),
  },
  object: {
    defaultCode: 'INVALID_OBJECT',
    describe: (field) => `${field} must be an object.`,
    validate: (_rule, value) => isPlainObject(value),
  },
  enum: {
    defaultCode: 'INVALID_ENUM',
    describe: (field) => `${field} must be a supported enum value.`,
    validate: (rule, value) => rule.values.includes(value),
  },
  int: {
    defaultCode: 'INVALID_INT',
    describe: (field) => `${field} must be an integer.`,
    validate: (_rule, value) => typeof value === 'number' && Number.isInteger(value),
  },
  divisibleBy: {
    defaultCode: 'DIVISIBLE_BY',
    describe: (field, rule) => `${field} must be divisible by ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'number' && !Number.isNaN(value) && value % rule.value === 0,
  },
  positive: {
    defaultCode: 'POSITIVE',
    describe: (field) => `${field} must be positive.`,
    validate: (_rule, value) => typeof value === 'number' && value > 0,
  },
  negative: {
    defaultCode: 'NEGATIVE',
    describe: (field) => `${field} must be negative.`,
    validate: (_rule, value) => typeof value === 'number' && value < 0,
  },
  min: {
    defaultCode: 'MIN',
    describe: (field, rule) => `${field} must be greater than or equal to ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'number' && !Number.isNaN(value) && value >= rule.value,
  },
  max: {
    defaultCode: 'MAX',
    describe: (field, rule) => `${field} must be less than or equal to ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'number' && !Number.isNaN(value) && value <= rule.value,
  },
  minDate: {
    defaultCode: 'MIN_DATE',
    describe: (field, rule) => `${field} must be on or after ${rule.value.toISOString()}.`,
    validate: (rule, value) => value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() >= rule.value.getTime(),
  },
  maxDate: {
    defaultCode: 'MAX_DATE',
    describe: (field, rule) => `${field} must be on or before ${rule.value.toISOString()}.`,
    validate: (rule, value) => value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() <= rule.value.getTime(),
  },
  contains: {
    defaultCode: 'CONTAINS',
    describe: (field, rule) => `${field} must contain ${rule.value}.`,
    validate: (rule, value) => typeof value === 'string' && value.includes(rule.value),
  },
  notContains: {
    defaultCode: 'NOT_CONTAINS',
    describe: (field, rule) => `${field} must not contain ${rule.value}.`,
    validate: (rule, value) => typeof value === 'string' && !value.includes(rule.value),
  },
  length: {
    defaultCode: 'LENGTH',
    describe: (field) => `${field} must have a valid length.`,
    validate: (rule, value) => typeof value === 'string' && value.length >= rule.min && (rule.max === undefined || value.length <= rule.max),
  },
  minLength: {
    defaultCode: 'MIN_LENGTH',
    describe: (field, rule) => `${field} must have length at least ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'string' && value.length >= rule.value,
  },
  maxLength: {
    defaultCode: 'MAX_LENGTH',
    describe: (field, rule) => `${field} must have length at most ${String(rule.value)}.`,
    validate: (rule, value) => typeof value === 'string' && value.length <= rule.value,
  },
  nested: {
    defaultCode: 'INVALID_NESTED',
    describe: (field) => `${field} contains invalid nested data.`,
    validate: () => true,
  },
  validatorjs: {
    defaultCode: 'INVALID_FIELD',
    describe: (field) => `${field} is invalid.`,
    validate: (rule, value) => typeof value === 'string' && runValidatorJs(rule, value),
  },
  arrayContains: {
    defaultCode: 'ARRAY_CONTAINS',
    describe: (field) => `${field} must contain the required values.`,
    validate: (rule, value) => Array.isArray(value) && rule.values.every((expected: unknown) => value.includes(expected)),
  },
  arrayNotContains: {
    defaultCode: 'ARRAY_NOT_CONTAINS',
    describe: (field) => `${field} contains forbidden values.`,
    validate: (rule, value) => Array.isArray(value) && rule.values.every((expected: unknown) => !value.includes(expected)),
  },
  arrayNotEmpty: {
    defaultCode: 'ARRAY_NOT_EMPTY',
    describe: (field) => `${field} must not be an empty array.`,
    validate: (_rule, value) => Array.isArray(value) && value.length > 0,
  },
  arrayMinSize: {
    defaultCode: 'ARRAY_MIN_SIZE',
    describe: (field, rule) => `${field} must contain at least ${String(rule.value)} items.`,
    validate: (rule, value) => Array.isArray(value) && value.length >= rule.value,
  },
  arrayMaxSize: {
    defaultCode: 'ARRAY_MAX_SIZE',
    describe: (field, rule) => `${field} must contain at most ${String(rule.value)} items.`,
    validate: (rule, value) => Array.isArray(value) && value.length <= rule.value,
  },
  arrayUnique: {
    defaultCode: 'ARRAY_UNIQUE',
    describe: (field) => `${field} must contain unique values.`,
    validate: (rule, value) => {
      if (!Array.isArray(value)) return false;
      const seen = new Set<unknown>();
      for (const entry of value) {
        const key = rule.selector ? rule.selector(entry) : entry;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
  },
  custom: {
    defaultCode: 'INVALID_FIELD',
    describe: (field) => `${field} is invalid.`,
    validate: () => true,
  },
};

function createNestedDtoInstance<T>(target: Constructor<T>, rawValue: unknown): T {
  if (rawValue instanceof target) {
    return rawValue as T;
  }

  const instance = new target() as Record<PropertyKey, unknown>;

  if (!isPlainObject(rawValue)) {
    return Object.assign(instance, rawValue) as T;
  }

  Object.assign(instance, rawValue);

  const metadata = getCachedDtoMetadata(target);
  applyBindingValues(instance, rawValue, metadata.mergedPropertyKeys, metadata.bindingMap);

  for (const entry of metadata.dtoValidationSchema) {
    const nestedRule = entry.rules.find(
      (rule: DtoFieldValidationRule): rule is Extract<DtoFieldValidationRule, { kind: 'nested' }> => rule.kind === 'nested',
    );

    if (!nestedRule) {
      continue;
    }

    const currentValue = instance[entry.propertyKey];
    if (currentValue === undefined || currentValue === null) {
      continue;
    }

    const resolvedDto = resolveNestedDto(nestedRule.dto);
    instance[entry.propertyKey] = nestedRule.each
      ? transformNestedEachValue(currentValue, resolvedDto)
      : transformNestedValue(currentValue, resolvedDto);
  }

  return instance as T;
}

function getDtoBindingMap(target: Constructor): Map<MetadataPropertyKey, DtoFieldBindingMetadata> {
  return new Map(
    getDtoBindingSchema(target).map((entry: { propertyKey: MetadataPropertyKey; metadata: DtoFieldBindingMetadata }) => [entry.propertyKey, entry.metadata]),
  );
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

function transformNestedValue(value: unknown, target: Constructor): unknown {
  return value === undefined || value === null ? value : createNestedDtoInstance(target, value);
}

function transformNestedEachValue(value: unknown, target: Constructor): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformNestedValue(item, target));
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (item) => transformNestedValue(item, target)));
  }

  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, item]) => [key, transformNestedValue(item, target)]));
  }

  return transformNestedValue(value, target);
}

function describeValidator(rule: DtoFieldValidationRule, field: string): { code: string; message: string } {
  if (rule.kind === 'validatorjs') {
    const handler = getRuleHandler(rule);
    return {
      code: rule.code ?? rule.validator.toUpperCase(),
      message: rule.message ?? handler.describe(field, rule),
    };
  }

  const handler = getRuleHandler(rule);

  return {
    code: rule.code ?? handler.defaultCode,
    message: rule.message ?? handler.describe(field, rule),
  };
}

function runValidatorJs(rule: Extract<DtoFieldValidationRule, { kind: 'validatorjs' }>, value: string): boolean {
  switch (rule.validator) {
    case 'alpha': return validator.isAlpha(value);
    case 'alphanumeric': return validator.isAlphanumeric(value);
    case 'ascii': return validator.isAscii(value);
    case 'base64': return validator.isBase64(value);
    case 'booleanString': return validator.isBoolean(value);
    case 'currency': return validator.isCurrency(value, rule.args?.[0] as validator.IsCurrencyOptions | undefined);
    case 'dataURI': return validator.isDataURI(value);
    case 'dateString': return validator.isDate(value);
    case 'decimal': return validator.isDecimal(value);
    case 'email': return validator.isEmail(value, rule.args?.[0] as validator.IsEmailOptions | undefined);
    case 'fqdn': return validator.isFQDN(value, rule.args?.[0] as validator.IsFQDNOptions | undefined);
    case 'hexColor': return validator.isHexColor(value);
    case 'hexadecimal': return validator.isHexadecimal(value);
    case 'ip': return validator.isIP(value, rule.args?.[0] as '4' | '6' | undefined);
    case 'isbn': return validator.isISBN(value, rule.args?.[0] as '10' | '13' | undefined);
    case 'issn': return validator.isISSN(value);
    case 'json': return validator.isJSON(value);
    case 'jwt': return validator.isJWT(value);
    case 'locale': return validator.isLocale(value);
    case 'lowercase': return validator.isLowercase(value);
    case 'magnetURI': return validator.isMagnetURI(value);
    case 'matches': return validator.matches(value, rule.args?.[0] as string, rule.args?.[1] as string | undefined);
    case 'mimeType': return validator.isMimeType(value);
    case 'mobilePhone': return validator.isMobilePhone(value, rule.args?.[0] as validator.MobilePhoneLocale | validator.MobilePhoneLocale[] | undefined);
    case 'mongoId': return validator.isMongoId(value);
    case 'numberString': return validator.isNumeric(value);
    case 'port': return validator.isPort(value);
    case 'postalCode': return validator.isPostalCode(value, (rule.args?.[0] as validator.PostalCodeLocale | 'any' | undefined) ?? 'any');
    case 'rgbColor': return validator.isRgbColor(value, rule.args?.[0] as boolean | undefined);
    case 'rfc3339': return validator.isRFC3339(value);
    case 'semVer': return validator.isSemVer(value);
    case 'uppercase': return validator.isUppercase(value);
    case 'url': return validator.isURL(value, rule.args?.[0] as validator.IsURLOptions | undefined);
    case 'uuid': return validator.isUUID(value, rule.args?.[0] as validator.UUIDVersion | undefined);
    case 'iso8601': return validator.isISO8601(value);
    case 'latitude': { const number = Number(value); return !Number.isNaN(number) && number >= -90 && number <= 90; }
    case 'longitude': { const number = Number(value); return !Number.isNaN(number) && number >= -180 && number <= 180; }
    case 'latLong': return validator.isLatLong(value);
    default: return false;
  }
}

function buildIssue(fallback: { code: string; message: string }, field: string, source: ValidationIssue['source']): ValidationIssue {
  return {
    code: fallback.code,
    field,
    message: fallback.message,
    source,
  };
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
): Promise<ValidationIssue[]> {
  const values = rule.each ? getIterableValues(value) ?? [value] : [value];
  const issues: ValidationIssue[] = [];
  const resolvedDto = resolveNestedDto(rule.dto);

  for (const [index, entry] of values.entries()) {
    if (entry === undefined || entry === null) continue;
    const nestedPath = rule.each ? `${fieldPath}[${String(index)}]` : fieldPath;
    const nestedDto = createNestedDtoInstance(resolvedDto, entry);
    issues.push(...(await collectValidationIssuesInternal(resolvedDto, nestedDto, { fieldPrefix: nestedPath, inheritedSource })));
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
): Promise<ValidationIssue[]> {
  const fallback = describeValidator(rule, fieldPath);

  if (rule.kind === 'custom') {
    return evaluateCustomRule(rule, value, dto, propertyKey, fieldPath, source, fallback);
  }

  if (rule.kind === 'nested') {
    return validateNestedRule(rule, value, fieldPath, source);
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
): Promise<ValidationIssue[]> {
  const conditionallySkip = await (async () => {
    for (const rule of rules) {
      if (rule.kind === 'validateIf' && !(await rule.validateIf(dto, value))) {
        return true;
      }
    }

    return false;
  })();

  if (rules.some((rule) => rule.kind === 'optional') && (value === undefined || value === null)) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    if (rule.kind === 'validateIf' || rule.kind === 'optional') continue;
    if (conditionallySkip) continue;
    if (shouldSkipRuleForMissingValue(rule, value)) continue;
    issues.push(...(await evaluateRule(rule, value, dto, propertyKey, fieldPath, source)));
  }

  return issues;
}

async function validateClassRule(rule: ClassValidationRule, dto: unknown): Promise<ValidationIssue[]> {
  return normalizeResult(await rule.validate(dto), undefined, undefined, {
    code: rule.code ?? 'INVALID_DTO',
    message: rule.message ?? 'DTO validation failed.',
  });
}

async function collectValidationIssues<T>(target: Constructor<T>, value: T): Promise<readonly ValidationIssue[]> {
  return collectValidationIssuesInternal(target, value, {});
}

async function collectValidationIssuesInternal<T>(
  target: Constructor<T>,
  value: T,
  context: { fieldPrefix?: string; inheritedSource?: ValidationIssue['source'] },
): Promise<readonly ValidationIssue[]> {
  const metadata = getCachedDtoMetadata(target);
  const issues: ValidationIssue[] = [];

  for (const entry of metadata.dtoValidationSchema) {
    const fieldValue = (value as Record<PropertyKey, unknown>)[entry.propertyKey];
    const source = metadata.bindingMap.get(entry.propertyKey)?.source ?? context.inheritedSource;
    const fieldPath = context.fieldPrefix ? joinFieldPath(context.fieldPrefix, toFieldName(entry.propertyKey)) : toFieldName(entry.propertyKey);
    issues.push(...(await applyPropertyRules(entry.rules, fieldValue, value, entry.propertyKey, fieldPath, source)));
  }

  for (const rule of metadata.classValidationRules) {
    const classIssues = await validateClassRule(rule, value);
    issues.push(...(context.fieldPrefix ? prefixIssues(classIssues, context.fieldPrefix, context.inheritedSource) : classIssues));
  }

  return issues;
}

export class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void> {
    const issues = await collectValidationIssues(target, value);
    if (issues.length === 0) return;
    throw new DtoValidationError('Validation failed.', issues);
  }

  async transform<T>(value: unknown, target: Constructor<T>): Promise<T> {
    const instance = createNestedDtoInstance(target, value);
    const issues = await collectValidationIssues(target, instance);

    if (issues.length > 0) {
      throw new DtoValidationError('Validation failed.', issues);
    }

    return instance as T;
  }
}
