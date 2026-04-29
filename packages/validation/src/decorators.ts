import {
  type Constructor,
  type MetadataPropertyKey,
} from '@fluojs/core';
import {
  metadataSymbol,
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

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  if (metadata === null || metadata === undefined) {
    throw new Error('Decorator metadata is not available. Ensure your environment supports TC39 decorator metadata (Stage 3).');
  }

  void metadataSymbol;
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
 * Provides the is defined value.
 */
export const IsDefined = createFlagValidationDecorator((options) => ({ kind: 'defined', ...options }));
/**
 * Provides the is optional value.
 */
export const IsOptional = createFlagValidationDecorator((options) => ({ kind: 'optional', ...options }));
/**
 * Provides the equals value.
 */
export const Equals = createValidationOptionsWithConfigDecorator<unknown>((value, options) => ({ kind: 'equals', value, ...options }));
/**
 * Provides the not equals value.
 */
export const NotEquals = createValidationOptionsWithConfigDecorator<unknown>((value, options) => ({ kind: 'notEquals', value, ...options }));
/**
 * Provides the is empty value.
 */
export const IsEmpty = createFlagValidationDecorator((options) => ({ kind: 'empty', ...options }));
/**
 * Provides the is not empty value.
 */
export const IsNotEmpty = createFlagValidationDecorator((options) => ({ kind: 'notEmpty', ...options }));
/**
 * Provides the is in value.
 */
export const IsIn = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'in', values, ...options }));
/**
 * Provides the is not in value.
 */
export const IsNotIn = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'notIn', values, ...options }));
/**
 * Provides the is date value.
 */
export const IsDate = createFlagValidationDecorator((options) => ({ kind: 'date', ...options }));
/**
 * Provides the is array value.
 */
export const IsArray = createFlagValidationDecorator((options) => ({ kind: 'array', ...options }));
/**
 * Provides the is object value.
 */
export const IsObject = createFlagValidationDecorator((options) => ({ kind: 'object', ...options }));
/**
 * Provides the is int value.
 */
export const IsInt = createFlagValidationDecorator((options) => ({ kind: 'int', ...options }));
/**
 * Provides the is positive value.
 */
export const IsPositive = createFlagValidationDecorator((options) => ({ kind: 'positive', ...options }));
/**
 * Provides the is negative value.
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
 * Provides the is divisible by value.
 */
export const IsDivisibleBy = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'divisibleBy', value, ...options }));
/**
 * Provides the min value.
 */
export const Min = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'min', value, ...options }));
/**
 * Provides the max value.
 */
export const Max = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'max', value, ...options }));
/**
 * Provides the min date value.
 */
export const MinDate = createValidationOptionsWithConfigDecorator<Date>((value, options) => ({ kind: 'minDate', value, ...options }));
/**
 * Provides the max date value.
 */
export const MaxDate = createValidationOptionsWithConfigDecorator<Date>((value, options) => ({ kind: 'maxDate', value, ...options }));
/**
 * Provides the contains value.
 */
export const Contains = createValidationOptionsWithConfigDecorator<string>((value, options) => ({ kind: 'contains', value, ...options }));
/**
 * Provides the not contains value.
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
 * Provides the min length value.
 */
export const MinLength = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'minLength', value, ...options }));
/**
 * Provides the max length value.
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
 * Provides the is alpha value.
 *
 * @param options The options.
 */
export const IsAlpha = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('alpha')(undefined, options);
/**
 * Provides the is alphanumeric value.
 *
 * @param options The options.
 */
export const IsAlphanumeric = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('alphanumeric')(undefined, options);
/**
 * Provides the is ascii value.
 *
 * @param options The options.
 */
export const IsAscii = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('ascii')(undefined, options);
/**
 * Provides the is base64 value.
 *
 * @param options The options.
 */
export const IsBase64 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('base64')(undefined, options);
/**
 * Provides the is boolean string value.
 *
 * @param options The options.
 */
export const IsBooleanString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('booleanString')(undefined, options);
/**
 * Provides the is data uri value.
 *
 * @param options The options.
 */
export const IsDataURI = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('dataURI')(undefined, options);
/**
 * Provides the is date string value.
 *
 * @param options The options.
 */
export const IsDateString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('dateString')(undefined, options);
/**
 * Provides the is decimal value.
 *
 * @param options The options.
 */
export const IsDecimal = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('decimal')(undefined, options);
/**
 * Provides the is email value.
 *
 * @param options The options.
 */
export const IsEmail = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('email')(undefined, options);
/**
 * Provides the is fqdn value.
 *
 * @param options The options.
 */
export const IsFQDN = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('fqdn')(undefined, options);
/**
 * Provides the is hex color value.
 *
 * @param options The options.
 */
export const IsHexColor = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('hexColor')(undefined, options);
/**
 * Provides the is hexadecimal value.
 *
 * @param options The options.
 */
export const IsHexadecimal = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('hexadecimal')(undefined, options);
/**
 * Provides the is json value.
 *
 * @param options The options.
 */
export const IsJSON = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('json')(undefined, options);
/**
 * Provides the is jwt value.
 *
 * @param options The options.
 */
export const IsJWT = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('jwt')(undefined, options);
/**
 * Provides the is locale value.
 *
 * @param options The options.
 */
export const IsLocale = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('locale')(undefined, options);
/**
 * Provides the is lowercase value.
 *
 * @param options The options.
 */
export const IsLowercase = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('lowercase')(undefined, options);
/**
 * Provides the is magnet uri value.
 *
 * @param options The options.
 */
export const IsMagnetURI = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('magnetURI')(undefined, options);
/**
 * Provides the is mime type value.
 *
 * @param options The options.
 */
export const IsMimeType = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('mimeType')(undefined, options);
/**
 * Provides the is mongo id value.
 *
 * @param options The options.
 */
export const IsMongoId = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('mongoId')(undefined, options);
/**
 * Provides the is number string value.
 *
 * @param options The options.
 */
export const IsNumberString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('numberString')(undefined, options);
/**
 * Provides the is port value.
 *
 * @param options The options.
 */
export const IsPort = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('port')(undefined, options);
/**
 * Provides the is rfc3339 value.
 *
 * @param options The options.
 */
export const IsRFC3339 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('rfc3339')(undefined, options);
/**
 * Provides the is sem ver value.
 *
 * @param options The options.
 */
export const IsSemVer = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('semVer')(undefined, options);
/**
 * Provides the is uppercase value.
 *
 * @param options The options.
 */
export const IsUppercase = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('uppercase')(undefined, options);
/**
 * Provides the is iso8601 value.
 *
 * @param options The options.
 */
export const IsISO8601 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('iso8601')(undefined, options);
/**
 * Provides the is latitude value.
 *
 * @param options The options.
 */
export const IsLatitude = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('latitude')(undefined, options);
/**
 * Provides the is longitude value.
 *
 * @param options The options.
 */
export const IsLongitude = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('longitude')(undefined, options);
/**
 * Provides the is lat long value.
 *
 * @param options The options.
 */
export const IsLatLong = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('latLong')(undefined, options);

/**
 *  Validates that a value is an IPv4/IPv6 address.
 *
 * @param version The version.
 * @param options The options.
 * @returns The is ip result.
 */
export function IsIP(version?: '4' | '6' | '4_or_6', options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('ip')(version ? [version] : undefined, options);
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
 * Provides the array contains value.
 */
export const ArrayContains = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'arrayContains', values, ...options }));
/**
 * Provides the array not contains value.
 */
export const ArrayNotContains = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'arrayNotContains', values, ...options }));
/**
 * Provides the array not empty value.
 */
export const ArrayNotEmpty = createFlagValidationDecorator((options) => ({ kind: 'arrayNotEmpty', ...options }));
/**
 * Provides the array min size value.
 */
export const ArrayMinSize = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'arrayMinSize', value, ...options }));
/**
 * Provides the array max size value.
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
