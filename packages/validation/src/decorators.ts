import type {
  Constructor,
  MetadataPropertyKey,
} from '@fluojs/core';
import {
  ensureMetadataSymbol,
  type ClassValidationRule,
  type CustomClassValidator,
  type CustomFieldValidator,
  type CustomValidationDecoratorOptions,
  type DtoFieldValidationRule,
  type ValidationDecoratorOptions,
} from '@fluojs/core/internal';

import { createClassValidatorFromStandardSchema, isStandardSchemaLike, type StandardSchemaV1Like } from './standard-schema.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type ClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type FieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type ValidatorJsRuleName = Extract<DtoFieldValidationRule, { kind: 'validatorjs' }>['validator'];
type ValidateClassInput = CustomClassValidator | StandardSchemaV1Like;

const standardDtoValidationMetadataKey = Symbol.for('fluo.standard.dto-validation');
const standardClassValidationMetadataKey = Symbol.for('fluo.standard.class-validation');

ensureMetadataSymbol();

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  if (metadata === null || metadata === undefined) {
    throw new Error('Decorator metadata is not available. Ensure your environment supports TC39 decorator metadata (Stage 3).');
  }

  return metadata as StandardMetadataBag;
}

function getStandardDtoValidationMap(metadata: unknown): Map<MetadataPropertyKey, DtoFieldValidationRule[]> {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardDtoValidationMetadataKey] as Map<MetadataPropertyKey, DtoFieldValidationRule[]> | undefined;

  if (current) {
    return current;
  }

  const created = new Map<MetadataPropertyKey, DtoFieldValidationRule[]>();
  bag[standardDtoValidationMetadataKey] = created;
  return created;
}

function getStandardClassValidationList(metadata: unknown): ClassValidationRule[] {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardClassValidationMetadataKey] as ClassValidationRule[] | undefined;

  if (current) {
    return current;
  }

  const created: ClassValidationRule[] = [];
  bag[standardClassValidationMetadataKey] = created;
  return created;
}

function appendStandardDtoValidationRule(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  const map = getStandardDtoValidationMap(metadata);
  map.set(propertyKey, [...(map.get(propertyKey) ?? []), rule]);
}

function appendStandardClassValidationRule(metadata: unknown, rule: ClassValidationRule): void {
  getStandardClassValidationList(metadata).push(rule);
}

function resolveClassValidator(validate: ValidateClassInput): CustomClassValidator {
  if (!isStandardSchemaLike(validate)) {
    return validate;
  }

  return createClassValidatorFromStandardSchema(validate);
}

function createValidationDecorator(ruleFactory: () => DtoFieldValidationRule): FieldDecoratorFn {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    appendStandardDtoValidationRule(context.metadata, context.name, ruleFactory());
  };

  return decorator as FieldDecoratorFn;
}

function createValidationOptionsWithConfigDecorator<T>(
  ruleFactory: (value: T, options: ValidationDecoratorOptions | undefined) => DtoFieldValidationRule,
) {
  return (value: T, options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ruleFactory(value, options));
  };
}

function createFlagValidationDecorator(
  ruleFactory: (options: ValidationDecoratorOptions | undefined) => DtoFieldValidationRule,
) {
  return (options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ruleFactory(options));
  };
}

function createArrayValidationDecorator<T>(
  ruleFactory: (values: readonly T[], options: ValidationDecoratorOptions | undefined) => DtoFieldValidationRule,
) {
  return (values: readonly T[], options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ruleFactory(values, options));
  };
}

function createValidatorJsDecorator(validator: ValidatorJsRuleName) {
  return (args?: readonly unknown[], options?: ValidationDecoratorOptions): FieldDecoratorFn => {
    return createValidationDecorator(() => ({
      args,
      kind: 'validatorjs',
      validator,
      ...options,
    }));
  };
}

/**
 * Validates that the decorated field is a string value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a string validation rule.
 */
export function IsString(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'string', ...options }));
}

/**
 * Validates that the decorated field is a number value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a number validation rule.
 */
export function IsNumber(options?: ValidationDecoratorOptions & { allowNaN?: boolean }): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'number', ...options }));
}

/**
 * Validates that the decorated field is a boolean value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a boolean validation rule.
 */
export function IsBoolean(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'boolean', ...options }));
}

/**
 * Applies subsequent validators only when the condition returns `true`.
 *
 * @param validateIf Predicate that decides whether subsequent validators should run.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that adds conditional validation execution.
 */
export const ValidateIf = (
  validateIf: (dto: unknown, value: unknown) => boolean | Promise<boolean>,
  options?: ValidationDecoratorOptions,
) => createValidationDecorator(() => ({ kind: 'validateIf', validateIf, ...options }));

/**
 * Validates that the decorated field is neither `null` nor `undefined`.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a required-value rule.
 */
export const IsDefined = createFlagValidationDecorator((options) => ({ kind: 'defined', ...options }));
/**
 * Skips subsequent validators when the decorated field is `null` or `undefined`.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers optional-value semantics.
 */
export const IsOptional = createFlagValidationDecorator((options) => ({ kind: 'optional', ...options }));
/**
 * Validates that the decorated field strictly equals the expected value.
 *
 * @param value Expected value to compare against the field value.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an equality rule.
 */
export const Equals = createValidationOptionsWithConfigDecorator<unknown>((value, options) => ({ kind: 'equals', value, ...options }));
/**
 * Validates that the decorated field does not strictly equal the forbidden value.
 *
 * @param value Forbidden value to compare against the field value.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an inequality rule.
 */
export const NotEquals = createValidationOptionsWithConfigDecorator<unknown>((value, options) => ({ kind: 'notEquals', value, ...options }));
/**
 * Validates that the decorated field is empty.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an empty-value rule.
 */
export const IsEmpty = createFlagValidationDecorator((options) => ({ kind: 'empty', ...options }));
/**
 * Validates that the decorated field is not empty.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a non-empty-value rule.
 */
export const IsNotEmpty = createFlagValidationDecorator((options) => ({ kind: 'notEmpty', ...options }));
/**
 * Validates that the decorated field is included in the accepted values.
 *
 * @param values Accepted values for the field.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an inclusion rule.
 */
export const IsIn = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'in', values, ...options }));
/**
 * Validates that the decorated field is not included in the rejected values.
 *
 * @param values Rejected values for the field.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an exclusion rule.
 */
export const IsNotIn = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'notIn', values, ...options }));
/**
 * Validates that the decorated field is a `Date` value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a date validation rule.
 */
export const IsDate = createFlagValidationDecorator((options) => ({ kind: 'date', ...options }));
/**
 * Validates that the decorated field is an array.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an array validation rule.
 */
export const IsArray = createFlagValidationDecorator((options) => ({ kind: 'array', ...options }));
/**
 * Validates that the decorated field is an object value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an object validation rule.
 */
export const IsObject = createFlagValidationDecorator((options) => ({ kind: 'object', ...options }));
/**
 * Validates that the decorated field is an integer.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an integer validation rule.
 */
export const IsInt = createFlagValidationDecorator((options) => ({ kind: 'int', ...options }));
/**
 * Validates that the decorated field is a positive number.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a positive-number rule.
 */
export const IsPositive = createFlagValidationDecorator((options) => ({ kind: 'positive', ...options }));
/**
 * Validates that the decorated field is a negative number.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a negative-number rule.
 */
export const IsNegative = createFlagValidationDecorator((options) => ({ kind: 'negative', ...options }));

/**
 * Validates that the field value is included in the given enum-like set.
 *
 * @param values Enum object or literal value list that defines the accepted set.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an enum-membership rule.
 */
export function IsEnum(values: Record<string, unknown> | readonly unknown[], options?: ValidationDecoratorOptions): FieldDecoratorFn {
  const normalized = Array.isArray(values) ? values : Object.values(values);
  return createValidationDecorator(() => ({ kind: 'enum', values: normalized, ...options }));
}

/**
 * Validates that the decorated field is divisible by the given divisor.
 *
 * @param value Divisor used for the numeric divisibility check.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a divisibility rule.
 */
export const IsDivisibleBy = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'divisibleBy', value, ...options }));
/**
 * Validates that the decorated field is greater than or equal to the minimum.
 *
 * @param value Inclusive minimum allowed numeric value.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a minimum-value rule.
 */
export const Min = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'min', value, ...options }));
/**
 * Validates that the decorated field is less than or equal to the maximum.
 *
 * @param value Inclusive maximum allowed numeric value.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a maximum-value rule.
 */
export const Max = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'max', value, ...options }));
/**
 * Validates that the decorated field is on or after the minimum date.
 *
 * @param value Inclusive minimum allowed date.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a minimum-date rule.
 */
export const MinDate = createValidationOptionsWithConfigDecorator<Date>((value, options) => ({ kind: 'minDate', value, ...options }));
/**
 * Validates that the decorated field is on or before the maximum date.
 *
 * @param value Inclusive maximum allowed date.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a maximum-date rule.
 */
export const MaxDate = createValidationOptionsWithConfigDecorator<Date>((value, options) => ({ kind: 'maxDate', value, ...options }));
/**
 * Validates that the decorated field contains the required substring.
 *
 * @param value Required substring.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a substring-presence rule.
 */
export const Contains = createValidationOptionsWithConfigDecorator<string>((value, options) => ({ kind: 'contains', value, ...options }));
/**
 * Validates that the decorated field does not contain the forbidden substring.
 *
 * @param value Forbidden substring.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a substring-exclusion rule.
 */
export const NotContains = createValidationOptionsWithConfigDecorator<string>((value, options) => ({ kind: 'notContains', value, ...options }));

/**
 * Validates string length using optional min/max boundaries.
 *
 * @param min Minimum inclusive length.
 * @param max Optional maximum inclusive length.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a bounded-length rule.
 */
export function Length(min: number, max?: number, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'length', max, min, ...options }));
}

/**
 * Validates a nested DTO instance using the provided constructor.
 *
 * @param dto DTO constructor (or lazy constructor factory) used for nested validation/materialization.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers recursive nested DTO validation.
 */
export function ValidateNested(dto: Constructor | (() => Constructor), options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({
    dto,
    kind: 'nested',
    ...options,
  }));
}

/**
 * Validates that the decorated field has at least the given length.
 *
 * @param value Inclusive minimum string length.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a minimum-length rule.
 */
export const MinLength = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'minLength', value, ...options }));
/**
 * Validates that the decorated field has at most the given length.
 *
 * @param value Inclusive maximum string length.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a maximum-length rule.
 */
export const MaxLength = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'maxLength', value, ...options }));

/**
 * Validates the field using a regular expression pattern.
 *
 * @param pattern Pattern source (`RegExp` or string) passed to validator.js `matches`.
 * @param modifiersOrOptions Regex modifiers string (for string patterns) or validation options.
 * @param options Validation options used when modifiers are provided separately.
 * @returns A field decorator that registers a regex-matching rule.
 */
export function Matches(
  pattern: RegExp | string,
  modifiersOrOptions?: string | ValidationDecoratorOptions,
  options?: ValidationDecoratorOptions,
): FieldDecoratorFn {
  const resolvedOptions = typeof modifiersOrOptions === 'object' ? modifiersOrOptions : options;

  if (pattern instanceof RegExp) {
    return createValidationDecorator(() => ({
      args: [pattern.source, pattern.flags],
      kind: 'validatorjs',
      validator: 'matches',
      ...resolvedOptions,
    } as DtoFieldValidationRule));
  }

  return createValidationDecorator(() => ({
    args: [pattern, typeof modifiersOrOptions === 'string' ? modifiersOrOptions : undefined].filter((value) => value !== undefined),
    kind: 'validatorjs',
    validator: 'matches',
    ...resolvedOptions,
  } as DtoFieldValidationRule));
}

/**
 * Validates that the decorated field contains only alphabetic characters.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an alphabetic string rule.
 */
export const IsAlpha = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('alpha')(undefined, options);
/**
 * Validates that the decorated field contains only alphanumeric characters.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an alphanumeric string rule.
 */
export const IsAlphanumeric = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('alphanumeric')(undefined, options);
/**
 * Validates that the decorated field contains only ASCII characters.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an ASCII string rule.
 */
export const IsAscii = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('ascii')(undefined, options);
/**
 * Validates that the decorated field is a Base64 string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a Base64 string rule.
 */
export const IsBase64 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('base64')(undefined, options);
/**
 * Validates that the decorated field is a boolean-like string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a boolean-string rule.
 */
export const IsBooleanString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('booleanString')(undefined, options);
/**
 * Validates that the decorated field is a data URI string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a data URI rule.
 */
export const IsDataURI = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('dataURI')(undefined, options);
/**
 * Validates that the decorated field is a date string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a date-string rule.
 */
export const IsDateString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('dateString')(undefined, options);
/**
 * Validates that the decorated field is a decimal string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a decimal-string rule.
 */
export const IsDecimal = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('decimal')(undefined, options);
/**
 * Validates that the decorated field is an email address.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an email-address rule.
 */
export const IsEmail = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('email')(undefined, options);
/**
 * Validates that the decorated field is a fully qualified domain name.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an FQDN rule.
 */
export const IsFQDN = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('fqdn')(undefined, options);
/**
 * Validates that the decorated field is a hexadecimal color string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a hex-color rule.
 */
export const IsHexColor = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('hexColor')(undefined, options);
/**
 * Validates that the decorated field is a hexadecimal string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a hexadecimal string rule.
 */
export const IsHexadecimal = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('hexadecimal')(undefined, options);
/**
 * Validates that the decorated field is a JSON string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a JSON-string rule.
 */
export const IsJSON = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('json')(undefined, options);
/**
 * Validates that the decorated field is a JSON Web Token string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a JWT-string rule.
 */
export const IsJWT = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('jwt')(undefined, options);
/**
 * Validates that the decorated field is a locale identifier.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a locale-string rule.
 */
export const IsLocale = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('locale')(undefined, options);
/**
 * Validates that the decorated field is lowercase.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a lowercase-string rule.
 */
export const IsLowercase = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('lowercase')(undefined, options);
/**
 * Validates that the decorated field is a magnet URI string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a magnet URI rule.
 */
export const IsMagnetURI = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('magnetURI')(undefined, options);
/**
 * Validates that the decorated field is a MIME type string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a MIME type rule.
 */
export const IsMimeType = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('mimeType')(undefined, options);
/**
 * Validates that the decorated field is a MongoDB object ID string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a MongoDB object ID rule.
 */
export const IsMongoId = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('mongoId')(undefined, options);
/**
 * Validates that the decorated field is a numeric string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a numeric-string rule.
 */
export const IsNumberString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('numberString')(undefined, options);
/**
 * Validates that the decorated field is a network port string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a port-string rule.
 */
export const IsPort = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('port')(undefined, options);
/**
 * Validates that the decorated field is an RFC 3339 date-time string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an RFC 3339 string rule.
 */
export const IsRFC3339 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('rfc3339')(undefined, options);
/**
 * Validates that the decorated field is a semantic version string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a semantic-version rule.
 */
export const IsSemVer = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('semVer')(undefined, options);
/**
 * Validates that the decorated field is uppercase.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an uppercase-string rule.
 */
export const IsUppercase = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('uppercase')(undefined, options);
/**
 * Validates that the decorated field is an ISO 8601 date-time string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an ISO 8601 string rule.
 */
export const IsISO8601 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('iso8601')(undefined, options);
/**
 * Validates that the decorated field is a latitude value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a latitude rule.
 */
export const IsLatitude = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('latitude')(undefined, options);
/**
 * Validates that the decorated field is a longitude value.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a longitude rule.
 */
export const IsLongitude = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('longitude')(undefined, options);
/**
 * Validates that the decorated field is a latitude/longitude coordinate string.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a latitude/longitude rule.
 */
export const IsLatLong = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('latLong')(undefined, options);

/**
 * Validates that a value is an IPv4 and/or IPv6 address.
 *
 * Passing `'4_or_6'` preserves the default validator.js behavior and accepts
 * either IP version. Passing `'4'` or `'6'` restricts validation to that
 * version only.
 *
 * @param version Optional IP version filter (`'4'`, `'6'`, or `'4_or_6'`).
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an IP-address rule.
 */
export function IsIP(version?: '4' | '6' | '4_or_6', options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('ip')(version && version !== '4_or_6' ? [version] : undefined, options);
}

/**
 *  Validates that a value is an ISBN string.
 *
 * @param version The version.
 * @param options The options.
 * @returns The is isbn result.
 */
export function IsISBN(version?: 10 | 13, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('isbn')(version ? [String(version)] : undefined, options);
}

/**
 * Is issn.
 *
 * @param options The options.
 * @returns The is issn result.
 */
export function IsISSN(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('issn')(undefined, options);
}

/**
 * Is mobile phone.
 *
 * @param locale The locale.
 * @param options The options.
 * @returns The is mobile phone result.
 */
export function IsMobilePhone(locale?: string | readonly string[], options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('mobilePhone')(locale ? [locale] : undefined, options);
}

/**
 * Is postal code.
 *
 * @param locale The locale.
 * @param options The options.
 * @returns The is postal code result.
 */
export function IsPostalCode(locale?: string, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('postalCode')(locale ? [locale] : undefined, options);
}

/**
 * Is rgb color.
 *
 * @param includePercentValues The include percent values.
 * @param options The options.
 * @returns The is rgb color result.
 */
export function IsRgbColor(includePercentValues?: boolean, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('rgbColor')(includePercentValues === undefined ? undefined : [includePercentValues], options);
}

/**
 * Is url.
 *
 * @param options The options.
 * @returns The is url result.
 */
export function IsUrl(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('url')(undefined, options);
}

/**
 * Is uuid.
 *
 * @param version The version.
 * @param options The options.
 * @returns The is uuid result.
 */
export function IsUUID(version?: '3' | '4' | '5' | 'all', options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('uuid')(version ? [version] : undefined, options);
}

/**
 * Is currency.
 *
 * @param options The options.
 * @returns The is currency result.
 */
export function IsCurrency(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('currency')(undefined, options);
}

/**
 * Validates that the decorated array contains all required values.
 *
 * @param values Required values that must be present in the array.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an array-contains rule.
 */
export const ArrayContains = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'arrayContains', values, ...options }));
/**
 * Validates that the decorated array excludes all forbidden values.
 *
 * @param values Forbidden values that must not be present in the array.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers an array-exclusion rule.
 */
export const ArrayNotContains = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'arrayNotContains', values, ...options }));
/**
 * Validates that the decorated array is not empty.
 *
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a non-empty-array rule.
 */
export const ArrayNotEmpty = createFlagValidationDecorator((options) => ({ kind: 'arrayNotEmpty', ...options }));
/**
 * Validates that the decorated array has at least the given size.
 *
 * @param value Inclusive minimum array length.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a minimum-array-size rule.
 */
export const ArrayMinSize = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'arrayMinSize', value, ...options }));
/**
 * Validates that the decorated array has at most the given size.
 *
 * @param value Inclusive maximum array length.
 * @param options Optional validation behavior (`message`, `groups`, `always`, `each`).
 * @returns A field decorator that registers a maximum-array-size rule.
 */
export const ArrayMaxSize = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'arrayMaxSize', value, ...options }));

/**
 * Ensures all values in the array are unique, optionally by selector.
 *
 * @param selectorOrOptions Optional selector callback used to compute uniqueness keys, or validation options.
 * @param options Validation options used when a selector callback is provided.
 * @returns A field decorator that registers an array-uniqueness rule.
 */
export function ArrayUnique(
  selectorOrOptions?: ((value: unknown) => unknown) | ValidationDecoratorOptions,
  options?: ValidationDecoratorOptions,
): FieldDecoratorFn {
  const selector = typeof selectorOrOptions === 'function' ? selectorOrOptions : undefined;
  const resolvedOptions = typeof selectorOrOptions === 'function' ? options : selectorOrOptions;

  return createValidationDecorator(() => ({ kind: 'arrayUnique', selector, ...resolvedOptions }));
}

/**
 * Registers a custom field-level validation function.
 *
 * @param validate Custom validator callback invoked with `(dto, value)`.
 * @param options Optional custom-validator metadata (`message`, `code`, `source`, `each`).
 * @returns A field decorator that registers a custom validation rule.
 */
export function Validate(validate: CustomFieldValidator, options?: CustomValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({
    code: options?.code,
    each: options?.each,
    kind: 'custom',
    message: options?.message,
    source: options?.source,
    validate,
  }));
}

/**
 * Registers class-level validation logic.
 * Supports either a custom validator callback or a Standard Schema object.
 *
 * @param validate Class-level validator callback or a Standard Schema-compatible validator definition.
 * @param options Optional validation behavior (`message`, `code`).
 * @returns A class decorator that appends class-level validation rules.
 */
export function ValidateClass(validate: ValidateClassInput, options?: ValidationDecoratorOptions): ClassDecoratorFn {
  const decorator = (_target: Function, context: ClassDecoratorContext) => {
    appendStandardClassValidationRule(context.metadata, {
      code: options?.code,
      message: options?.message,
      validate: resolveClassValidator(validate),
    });
  };

  return decorator as ClassDecoratorFn;
}
