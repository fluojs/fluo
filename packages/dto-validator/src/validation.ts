import validator from 'validator';

import {
  getClassValidationRules,
  getDtoBindingSchema,
  getDtoValidationSchema,
  type ClassValidationRule,
  type Constructor,
  type DtoFieldValidationRule,
  type MetadataPropertyKey,
  type ValidationIssueMetadata,
  type ValidationRuleResult,
} from '@konekti/core';

import { DtoValidationError } from './errors.js';
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

function createNestedDtoInstance<T>(target: Constructor<T>, rawValue: unknown): T {
  if (rawValue instanceof target) {
    return rawValue;
  }

  const instance = new target() as Record<PropertyKey, unknown>;

  if (!isPlainObject(rawValue)) {
    return Object.assign(instance, rawValue) as T;
  }

  Object.assign(instance, rawValue);

  const bindingMap = new Map(getDtoBindingSchema(target).map((entry) => [entry.propertyKey, entry.metadata]));
  const keys = new Set<MetadataPropertyKey>([
    ...bindingMap.keys(),
    ...getDtoValidationSchema(target).map((entry) => entry.propertyKey),
  ]);

  for (const propertyKey of keys) {
    const sourceKey = bindingMap.get(propertyKey)?.key;
    if (!sourceKey) continue;
    instance[propertyKey] = rawValue[sourceKey];
  }

  return instance as T;
}

function describeValidator(rule: DtoFieldValidationRule, field: string): { code: string; message: string } {
  switch (rule.kind) {
    case 'defined': return { code: rule.code ?? 'REQUIRED', message: rule.message ?? `${field} is required.` };
    case 'optional': return { code: rule.code ?? 'OPTIONAL', message: rule.message ?? `${field} is optional.` };
    case 'equals': return { code: rule.code ?? 'EQUALS', message: rule.message ?? `${field} must equal ${String(rule.value)}.` };
    case 'notEquals': return { code: rule.code ?? 'NOT_EQUALS', message: rule.message ?? `${field} must not equal ${String(rule.value)}.` };
    case 'empty': return { code: rule.code ?? 'EMPTY', message: rule.message ?? `${field} must be empty.` };
    case 'notEmpty': return { code: rule.code ?? 'NOT_EMPTY', message: rule.message ?? `${field} should not be empty.` };
    case 'in': return { code: rule.code ?? 'IN', message: rule.message ?? `${field} must be one of the allowed values.` };
    case 'notIn': return { code: rule.code ?? 'NOT_IN', message: rule.message ?? `${field} contains a forbidden value.` };
    case 'string': return { code: rule.code ?? 'INVALID_STRING', message: rule.message ?? `${field} must be a string.` };
    case 'number': return { code: rule.code ?? 'INVALID_NUMBER', message: rule.message ?? `${field} must be a number.` };
    case 'boolean': return { code: rule.code ?? 'INVALID_BOOLEAN', message: rule.message ?? `${field} must be a boolean.` };
    case 'date': return { code: rule.code ?? 'INVALID_DATE', message: rule.message ?? `${field} must be a Date instance.` };
    case 'array': return { code: rule.code ?? 'INVALID_ARRAY', message: rule.message ?? `${field} must be an array.` };
    case 'object': return { code: rule.code ?? 'INVALID_OBJECT', message: rule.message ?? `${field} must be an object.` };
    case 'enum': return { code: rule.code ?? 'INVALID_ENUM', message: rule.message ?? `${field} must be a supported enum value.` };
    case 'int': return { code: rule.code ?? 'INVALID_INT', message: rule.message ?? `${field} must be an integer.` };
    case 'divisibleBy': return { code: rule.code ?? 'DIVISIBLE_BY', message: rule.message ?? `${field} must be divisible by ${String(rule.value)}.` };
    case 'positive': return { code: rule.code ?? 'POSITIVE', message: rule.message ?? `${field} must be positive.` };
    case 'negative': return { code: rule.code ?? 'NEGATIVE', message: rule.message ?? `${field} must be negative.` };
    case 'min': return { code: rule.code ?? 'MIN', message: rule.message ?? `${field} must be greater than or equal to ${String(rule.value)}.` };
    case 'max': return { code: rule.code ?? 'MAX', message: rule.message ?? `${field} must be less than or equal to ${String(rule.value)}.` };
    case 'minDate': return { code: rule.code ?? 'MIN_DATE', message: rule.message ?? `${field} must be on or after ${rule.value.toISOString()}.` };
    case 'maxDate': return { code: rule.code ?? 'MAX_DATE', message: rule.message ?? `${field} must be on or before ${rule.value.toISOString()}.` };
    case 'contains': return { code: rule.code ?? 'CONTAINS', message: rule.message ?? `${field} must contain ${rule.value}.` };
    case 'notContains': return { code: rule.code ?? 'NOT_CONTAINS', message: rule.message ?? `${field} must not contain ${rule.value}.` };
    case 'length': return { code: rule.code ?? 'LENGTH', message: rule.message ?? `${field} must have a valid length.` };
    case 'minLength': return { code: rule.code ?? 'MIN_LENGTH', message: rule.message ?? `${field} must have length at least ${String(rule.value)}.` };
    case 'maxLength': return { code: rule.code ?? 'MAX_LENGTH', message: rule.message ?? `${field} must have length at most ${String(rule.value)}.` };
    case 'nested': return { code: rule.code ?? 'INVALID_NESTED', message: rule.message ?? `${field} contains invalid nested data.` };
    case 'validatorjs': return { code: rule.code ?? rule.validator.toUpperCase(), message: rule.message ?? `${field} is invalid.` };
    case 'arrayContains': return { code: rule.code ?? 'ARRAY_CONTAINS', message: rule.message ?? `${field} must contain the required values.` };
    case 'arrayNotContains': return { code: rule.code ?? 'ARRAY_NOT_CONTAINS', message: rule.message ?? `${field} contains forbidden values.` };
    case 'arrayNotEmpty': return { code: rule.code ?? 'ARRAY_NOT_EMPTY', message: rule.message ?? `${field} must not be an empty array.` };
    case 'arrayMinSize': return { code: rule.code ?? 'ARRAY_MIN_SIZE', message: rule.message ?? `${field} must contain at least ${String(rule.value)} items.` };
    case 'arrayMaxSize': return { code: rule.code ?? 'ARRAY_MAX_SIZE', message: rule.message ?? `${field} must contain at most ${String(rule.value)} items.` };
    case 'arrayUnique': return { code: rule.code ?? 'ARRAY_UNIQUE', message: rule.message ?? `${field} must contain unique values.` };
    case 'custom': return { code: rule.code ?? 'INVALID_FIELD', message: rule.message ?? `${field} is invalid.` };
    case 'validateIf': return { code: rule.code ?? 'VALIDATE_IF', message: rule.message ?? `${field} is conditionally invalid.` };
  }
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
    case 'dateString': return validator.isISO8601(value);
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
  }
}

function validateSingleRule(rule: DtoFieldValidationRule, value: unknown): boolean {
  switch (rule.kind) {
    case 'validateIf':
    case 'defined':
    case 'optional':
      return true;
    case 'equals': return value === rule.value;
    case 'notEquals': return value !== rule.value;
    case 'empty': return isEmptyValue(value);
    case 'notEmpty': return !isEmptyValue(value);
    case 'in': return rule.values.includes(value);
    case 'notIn': return !rule.values.includes(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && (rule.allowNaN || !Number.isNaN(value));
    case 'boolean': return typeof value === 'boolean';
    case 'date': return value instanceof Date && !Number.isNaN(value.getTime());
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
    case 'enum': return rule.values.includes(value);
    case 'int': return typeof value === 'number' && Number.isInteger(value);
    case 'divisibleBy': return typeof value === 'number' && !Number.isNaN(value) && value % rule.value === 0;
    case 'positive': return typeof value === 'number' && value > 0;
    case 'negative': return typeof value === 'number' && value < 0;
    case 'min': return typeof value === 'number' && !Number.isNaN(value) && value >= rule.value;
    case 'max': return typeof value === 'number' && !Number.isNaN(value) && value <= rule.value;
    case 'minDate': return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() >= rule.value.getTime();
    case 'maxDate': return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() <= rule.value.getTime();
    case 'contains': return typeof value === 'string' && value.includes(rule.value);
    case 'notContains': return typeof value === 'string' && !value.includes(rule.value);
    case 'length': return typeof value === 'string' && value.length >= rule.min && (rule.max === undefined || value.length <= rule.max);
    case 'minLength': return typeof value === 'string' && value.length >= rule.value;
    case 'maxLength': return typeof value === 'string' && value.length <= rule.value;
    case 'nested': return true;
    case 'validatorjs': return typeof value === 'string' && runValidatorJs(rule, value);
    case 'arrayContains': return Array.isArray(value) && rule.values.every((expected) => value.includes(expected));
    case 'arrayNotContains': return Array.isArray(value) && rule.values.every((expected) => !value.includes(expected));
    case 'arrayNotEmpty': return Array.isArray(value) && value.length > 0;
    case 'arrayMinSize': return Array.isArray(value) && value.length >= rule.value;
    case 'arrayMaxSize': return Array.isArray(value) && value.length <= rule.value;
    case 'arrayUnique': {
      if (!Array.isArray(value)) return false;
      const seen = new Set<unknown>();
      for (const entry of value) {
        const key = rule.selector ? rule.selector(entry) : entry;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    }
    case 'custom':
      return true;
  }
}

async function validateNestedRule(
  rule: Extract<DtoFieldValidationRule, { kind: 'nested' }>,
  value: unknown,
  fieldPath: string,
  inheritedSource: ValidationIssue['source'],
): Promise<ValidationIssue[]> {
  const values = rule.each ? getIterableValues(value) ?? [value] : [value];
  const issues: ValidationIssue[] = [];

  for (const [index, entry] of values.entries()) {
    if (entry === undefined || entry === null) continue;
    const nestedPath = rule.each ? `${fieldPath}[${String(index)}]` : fieldPath;
    const nestedDto = createNestedDtoInstance(rule.dto, entry);
    issues.push(...(await collectValidationIssuesInternal(rule.dto, nestedDto, { fieldPrefix: nestedPath, inheritedSource })));
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
    if (rule.each) {
      const values = getIterableValues(value) ?? [value];
      const issues: ValidationIssue[] = [];
      for (const [index, entry] of values.entries()) {
        const resultAtIndex = await rule.validate(entry, { dto, propertyKey });
        issues.push(...prefixIssues(normalizeResult(resultAtIndex, undefined, rule.source ?? source, fallback), `${fieldPath}[${String(index)}]`, source));
      }
      return issues;
    }
    return normalizeResult(await rule.validate(value, { dto, propertyKey }), fieldPath, rule.source ?? source, fallback);
  }

  if (rule.kind === 'nested') {
    return validateNestedRule(rule, value, fieldPath, source);
  }

  if (rule.each) {
    const values = getIterableValues(value) ?? [value];
    const issues: ValidationIssue[] = [];
    for (const [index, entry] of values.entries()) {
      if (!validateSingleRule(rule, entry)) {
        issues.push({ code: fallback.code, field: `${fieldPath}[${String(index)}]`, message: fallback.message, source });
      }
    }
    return issues;
  }

  if (!validateSingleRule(rule, value)) {
    return [{ code: fallback.code, field: fieldPath, message: fallback.message, source }];
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
  for (const rule of rules) {
    if (rule.kind === 'validateIf' && !(await rule.validateIf(dto, value))) {
      return [];
    }
  }

  if (rules.some((rule) => rule.kind === 'optional') && (value === undefined || value === null)) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    if (rule.kind === 'validateIf' || rule.kind === 'optional') continue;
    if ((value === undefined || value === null) && rule.kind !== 'defined' && rule.kind !== 'notEmpty' && rule.kind !== 'empty') continue;
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
  const bindingMetadata = new Map(getDtoBindingSchema(target).map((entry) => [entry.propertyKey, entry.metadata]));
  const issues: ValidationIssue[] = [];

  for (const entry of getDtoValidationSchema(target)) {
    const fieldValue = (value as Record<PropertyKey, unknown>)[entry.propertyKey];
    const source = bindingMetadata.get(entry.propertyKey)?.source ?? context.inheritedSource;
    const fieldPath = context.fieldPrefix ? joinFieldPath(context.fieldPrefix, toFieldName(entry.propertyKey)) : toFieldName(entry.propertyKey);
    issues.push(...(await applyPropertyRules(entry.rules, fieldValue, value, entry.propertyKey, fieldPath, source)));
  }

  for (const rule of getClassValidationRules(target)) {
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
}
