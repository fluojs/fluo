import type { Constructor, MaybePromise, MetadataPropertyKey, MetadataSource, Token } from '../types.js';

/**
 * Defines the metadata collection type.
 */
export type MetadataCollection<T = unknown> = T[];

/**
 * Describes the module metadata contract.
 */
export interface ModuleMetadata {
  imports?: MetadataCollection;
  providers?: MetadataCollection;
  controllers?: MetadataCollection;
  exports?: MetadataCollection;
  middleware?: MetadataCollection;
  global?: boolean;
}

/**
 * Describes the controller metadata contract.
 */
export interface ControllerMetadata {
  basePath: string;
  guards?: MetadataCollection;
  interceptors?: MetadataCollection;
  version?: string;
}

/**
 * Describes the route header contract.
 */
export interface RouteHeader {
  name: string;
  value: string;
}

/**
 * Describes the route redirect contract.
 */
export interface RouteRedirect {
  url: string;
  statusCode?: number;
}

/**
 * Describes the route metadata contract.
 */
export interface RouteMetadata {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  path: string;
  request?: new (...args: never[]) => unknown;
  guards?: MetadataCollection;
  headers?: RouteHeader[];
  interceptors?: MetadataCollection;
  redirect?: RouteRedirect;
  successStatus?: number;
  version?: string;
}

/**
 * Describes the dto field binding metadata contract.
 */
export interface DtoFieldBindingMetadata {
  source: MetadataSource;
  key?: string;
  optional?: boolean;
  converter?: Token | { convert(value: unknown, target: unknown): MaybePromise<unknown> };
}

/**
 * Describes the validation issue metadata contract.
 */
export interface ValidationIssueMetadata {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

/**
 * Defines the validation rule result type.
 */
export type ValidationRuleResult = boolean | void | ValidationIssueMetadata | readonly ValidationIssueMetadata[];

/**
 * Describes the validation decorator options contract.
 */
export interface ValidationDecoratorOptions {
  code?: string;
  each?: boolean;
  message?: string;
}

/**
 * Describes the custom validation decorator options contract.
 */
export interface CustomValidationDecoratorOptions extends ValidationDecoratorOptions {
  source?: MetadataSource;
}

/**
 * Describes the custom field validation context contract.
 */
export interface CustomFieldValidationContext<T = unknown> {
  dto: T;
  propertyKey: MetadataPropertyKey;
}

/**
 * Defines the custom field validator type.
 */
export type CustomFieldValidator<T = unknown> = (
  value: unknown,
  context: CustomFieldValidationContext<T>,
) => MaybePromise<ValidationRuleResult>;

/**
 * Defines the custom class validator type.
 */
export type CustomClassValidator<T = unknown> = (value: T) => MaybePromise<ValidationRuleResult>;

/**
 * Defines the conditional field validator type.
 */
export type ConditionalFieldValidator<T = unknown> = (
  dto: T,
  value: unknown,
) => MaybePromise<boolean>;

/**
 * Defines the dto field validation rule type.
 */
export type DtoFieldValidationRule =
  | ({ kind: 'validateIf'; validateIf: ConditionalFieldValidator } & ValidationDecoratorOptions)
  | ({ kind: 'defined' } & ValidationDecoratorOptions)
  | ({ kind: 'optional' } & ValidationDecoratorOptions)
  | ({ kind: 'equals'; value: unknown } & ValidationDecoratorOptions)
  | ({ kind: 'notEquals'; value: unknown } & ValidationDecoratorOptions)
  | ({ kind: 'empty' } & ValidationDecoratorOptions)
  | ({ kind: 'notEmpty' } & ValidationDecoratorOptions)
  | ({ kind: 'in'; values: readonly unknown[] } & ValidationDecoratorOptions)
  | ({ kind: 'notIn'; values: readonly unknown[] } & ValidationDecoratorOptions)
  | ({ kind: 'string' } & ValidationDecoratorOptions)
  | ({ kind: 'number'; allowNaN?: boolean } & ValidationDecoratorOptions)
  | ({ kind: 'boolean' } & ValidationDecoratorOptions)
  | ({ kind: 'date' } & ValidationDecoratorOptions)
  | ({ kind: 'array' } & ValidationDecoratorOptions)
  | ({ kind: 'object' } & ValidationDecoratorOptions)
  | ({ kind: 'enum'; values: readonly unknown[] } & ValidationDecoratorOptions)
  | ({ kind: 'int' } & ValidationDecoratorOptions)
  | ({ kind: 'divisibleBy'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'positive' } & ValidationDecoratorOptions)
  | ({ kind: 'negative' } & ValidationDecoratorOptions)
  | ({ kind: 'min'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'max'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'minDate'; value: Date } & ValidationDecoratorOptions)
  | ({ kind: 'maxDate'; value: Date } & ValidationDecoratorOptions)
  | ({ kind: 'contains'; value: string } & ValidationDecoratorOptions)
  | ({ kind: 'notContains'; value: string } & ValidationDecoratorOptions)
  | ({ kind: 'length'; min: number; max?: number } & ValidationDecoratorOptions)
  | ({ kind: 'minLength'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'maxLength'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'nested'; dto: Constructor | (() => Constructor) } & ValidationDecoratorOptions)
  | ({
      kind: 'validatorjs';
      validator:
        | 'alpha'
        | 'alphanumeric'
        | 'ascii'
        | 'base64'
        | 'booleanString'
        | 'currency'
        | 'dataURI'
        | 'dateString'
        | 'decimal'
        | 'email'
        | 'fqdn'
        | 'hexColor'
        | 'hexadecimal'
        | 'ip'
        | 'isbn'
        | 'issn'
        | 'json'
        | 'jwt'
        | 'locale'
        | 'lowercase'
        | 'magnetURI'
        | 'matches'
        | 'mimeType'
        | 'mobilePhone'
        | 'mongoId'
        | 'numberString'
        | 'port'
        | 'postalCode'
        | 'rgbColor'
        | 'rfc3339'
        | 'semVer'
        | 'uppercase'
        | 'url'
        | 'uuid'
        | 'iso8601'
        | 'latitude'
        | 'longitude'
        | 'latLong';
      args?: readonly unknown[];
    } & ValidationDecoratorOptions)
  | ({ kind: 'arrayContains'; values: readonly unknown[] } & ValidationDecoratorOptions)
  | ({ kind: 'arrayNotContains'; values: readonly unknown[] } & ValidationDecoratorOptions)
  | ({ kind: 'arrayNotEmpty' } & ValidationDecoratorOptions)
  | ({ kind: 'arrayMinSize'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'arrayMaxSize'; value: number } & ValidationDecoratorOptions)
  | ({ kind: 'arrayUnique'; selector?: (value: unknown) => unknown } & ValidationDecoratorOptions)
  | ({ kind: 'custom'; validate: CustomFieldValidator; source?: MetadataSource } & ValidationDecoratorOptions);

/**
 * Describes the class validation rule contract.
 */
export interface ClassValidationRule {
  code?: string;
  message?: string;
  validate: CustomClassValidator;
}

/**
 * Describes the injection metadata contract.
 */
export interface InjectionMetadata {
  token: unknown;
  optional?: boolean;
}

/**
 * Describes the class di metadata contract.
 */
export interface ClassDiMetadata {
  inject?: Token[];
  scope?: 'singleton' | 'request' | 'transient';
}

/**
 * Describes the dto binding schema entry contract.
 */
export interface DtoBindingSchemaEntry {
  propertyKey: MetadataPropertyKey;
  metadata: DtoFieldBindingMetadata;
}

/**
 * Describes the dto validation schema entry contract.
 */
export interface DtoValidationSchemaEntry {
  propertyKey: MetadataPropertyKey;
  rules: readonly DtoFieldValidationRule[];
}

/**
 * Describes the injection schema entry contract.
 */
export interface InjectionSchemaEntry {
  propertyKey: MetadataPropertyKey;
  metadata: InjectionMetadata;
}

/**
 * Describes the standard route metadata record contract.
 */
export interface StandardRouteMetadataRecord {
  guards?: MetadataCollection;
  headers?: RouteHeader[];
  interceptors?: MetadataCollection;
  method?: RouteMetadata['method'];
  path?: string;
  redirect?: RouteRedirect;
  request?: new (...args: never[]) => unknown;
  successStatus?: number;
  version?: string;
}

/**
 * Defines the standard dto binding record type.
 */
export type StandardDtoBindingRecord = Partial<DtoFieldBindingMetadata>;
/**
 * Defines the standard dto validation record type.
 */
export type StandardDtoValidationRecord = DtoFieldValidationRule[];
/**
 * Defines the standard injection record type.
 */
export type StandardInjectionRecord = Partial<InjectionMetadata>;
