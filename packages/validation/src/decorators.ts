import {
  metadataSymbol,
  type ClassValidationRule,
  type Constructor,
  type CustomClassValidator,
  type CustomFieldValidator,
  type CustomValidationDecoratorOptions,
  type DtoFieldValidationRule,
  type MetadataPropertyKey,
  type ValidationDecoratorOptions,
} from '@konekti/core';

import { createClassValidatorFromStandardSchema, isStandardSchemaLike, type StandardSchemaV1Like } from './standard-schema.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type ClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type FieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type ValidatorJsRuleName = Extract<DtoFieldValidationRule, { kind: 'validatorjs' }>['validator'];
type ValidateClassInput = CustomClassValidator | StandardSchemaV1Like;

const standardDtoValidationMetadataKey = Symbol.for('konekti.standard.dto-validation');
const standardClassValidationMetadataKey = Symbol.for('konekti.standard.class-validation');

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

export function IsString(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'string', ...options }));
}

export function IsNumber(options?: ValidationDecoratorOptions & { allowNaN?: boolean }): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'number', ...options }));
}

export function IsBoolean(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'boolean', ...options }));
}

export const ValidateIf = (
  validateIf: (dto: unknown, value: unknown) => boolean | Promise<boolean>,
  options?: ValidationDecoratorOptions,
) => createValidationDecorator(() => ({ kind: 'validateIf', validateIf, ...options }));

export const IsDefined = createFlagValidationDecorator((options) => ({ kind: 'defined', ...options }));
export const IsOptional = createFlagValidationDecorator((options) => ({ kind: 'optional', ...options }));
export const Equals = createValidationOptionsWithConfigDecorator<unknown>((value, options) => ({ kind: 'equals', value, ...options }));
export const NotEquals = createValidationOptionsWithConfigDecorator<unknown>((value, options) => ({ kind: 'notEquals', value, ...options }));
export const IsEmpty = createFlagValidationDecorator((options) => ({ kind: 'empty', ...options }));
export const IsNotEmpty = createFlagValidationDecorator((options) => ({ kind: 'notEmpty', ...options }));
export const IsIn = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'in', values, ...options }));
export const IsNotIn = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'notIn', values, ...options }));
export const IsDate = createFlagValidationDecorator((options) => ({ kind: 'date', ...options }));
export const IsArray = createFlagValidationDecorator((options) => ({ kind: 'array', ...options }));
export const IsObject = createFlagValidationDecorator((options) => ({ kind: 'object', ...options }));
export const IsInt = createFlagValidationDecorator((options) => ({ kind: 'int', ...options }));
export const IsPositive = createFlagValidationDecorator((options) => ({ kind: 'positive', ...options }));
export const IsNegative = createFlagValidationDecorator((options) => ({ kind: 'negative', ...options }));

export function IsEnum(values: Record<string, unknown> | readonly unknown[], options?: ValidationDecoratorOptions): FieldDecoratorFn {
  const normalized = Array.isArray(values) ? values : Object.values(values);
  return createValidationDecorator(() => ({ kind: 'enum', values: normalized, ...options }));
}

export const IsDivisibleBy = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'divisibleBy', value, ...options }));
export const Min = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'min', value, ...options }));
export const Max = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'max', value, ...options }));
export const MinDate = createValidationOptionsWithConfigDecorator<Date>((value, options) => ({ kind: 'minDate', value, ...options }));
export const MaxDate = createValidationOptionsWithConfigDecorator<Date>((value, options) => ({ kind: 'maxDate', value, ...options }));
export const Contains = createValidationOptionsWithConfigDecorator<string>((value, options) => ({ kind: 'contains', value, ...options }));
export const NotContains = createValidationOptionsWithConfigDecorator<string>((value, options) => ({ kind: 'notContains', value, ...options }));

export function Length(min: number, max?: number, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({ kind: 'length', max, min, ...options }));
}

export function ValidateNested(dto: Constructor | (() => Constructor), options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidationDecorator(() => ({
    dto,
    kind: 'nested',
    ...options,
  }));
}

export const MinLength = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'minLength', value, ...options }));
export const MaxLength = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'maxLength', value, ...options }));

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

export const IsAlpha = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('alpha')(undefined, options);
export const IsAlphanumeric = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('alphanumeric')(undefined, options);
export const IsAscii = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('ascii')(undefined, options);
export const IsBase64 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('base64')(undefined, options);
export const IsBooleanString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('booleanString')(undefined, options);
export const IsDataURI = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('dataURI')(undefined, options);
export const IsDateString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('dateString')(undefined, options);
export const IsDecimal = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('decimal')(undefined, options);
export const IsEmail = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('email')(undefined, options);
export const IsFQDN = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('fqdn')(undefined, options);
export const IsHexColor = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('hexColor')(undefined, options);
export const IsHexadecimal = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('hexadecimal')(undefined, options);
export const IsJSON = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('json')(undefined, options);
export const IsJWT = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('jwt')(undefined, options);
export const IsLocale = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('locale')(undefined, options);
export const IsLowercase = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('lowercase')(undefined, options);
export const IsMagnetURI = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('magnetURI')(undefined, options);
export const IsMimeType = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('mimeType')(undefined, options);
export const IsMongoId = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('mongoId')(undefined, options);
export const IsNumberString = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('numberString')(undefined, options);
export const IsPort = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('port')(undefined, options);
export const IsRFC3339 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('rfc3339')(undefined, options);
export const IsSemVer = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('semVer')(undefined, options);
export const IsUppercase = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('uppercase')(undefined, options);
export const IsISO8601 = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('iso8601')(undefined, options);
export const IsLatitude = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('latitude')(undefined, options);
export const IsLongitude = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('longitude')(undefined, options);
export const IsLatLong = (options?: ValidationDecoratorOptions) => createValidatorJsDecorator('latLong')(undefined, options);

export function IsIP(version?: '4' | '6' | '4_or_6', options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('ip')(version ? [version] : undefined, options);
}

export function IsISBN(version?: 10 | 13, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('isbn')(version ? [String(version)] : undefined, options);
}

export function IsISSN(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('issn')(undefined, options);
}

export function IsMobilePhone(locale?: string | readonly string[], options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('mobilePhone')(locale ? [locale] : undefined, options);
}

export function IsPostalCode(locale?: string, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('postalCode')(locale ? [locale] : undefined, options);
}

export function IsRgbColor(includePercentValues?: boolean, options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('rgbColor')(includePercentValues === undefined ? undefined : [includePercentValues], options);
}

export function IsUrl(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('url')(undefined, options);
}

export function IsUUID(version?: '3' | '4' | '5' | 'all', options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('uuid')(version ? [version] : undefined, options);
}

export function IsCurrency(options?: ValidationDecoratorOptions): FieldDecoratorFn {
  return createValidatorJsDecorator('currency')(undefined, options);
}

export const ArrayContains = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'arrayContains', values, ...options }));
export const ArrayNotContains = createArrayValidationDecorator<unknown>((values, options) => ({ kind: 'arrayNotContains', values, ...options }));
export const ArrayNotEmpty = createFlagValidationDecorator((options) => ({ kind: 'arrayNotEmpty', ...options }));
export const ArrayMinSize = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'arrayMinSize', value, ...options }));
export const ArrayMaxSize = createValidationOptionsWithConfigDecorator<number>((value, options) => ({ kind: 'arrayMaxSize', value, ...options }));

export function ArrayUnique(
  selectorOrOptions?: ((value: unknown) => unknown) | ValidationDecoratorOptions,
  options?: ValidationDecoratorOptions,
): FieldDecoratorFn {
  const selector = typeof selectorOrOptions === 'function' ? selectorOrOptions : undefined;
  const resolvedOptions = typeof selectorOrOptions === 'function' ? options : selectorOrOptions;

  return createValidationDecorator(() => ({ kind: 'arrayUnique', selector, ...resolvedOptions }));
}

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
