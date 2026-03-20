import type { Constructor, MaybePromise, MetadataPropertyKey, MetadataSource, Token } from '../types.js';

export type MetadataCollection<T = unknown> = readonly T[];

export interface ModuleMetadata {
  imports?: MetadataCollection;
  providers?: MetadataCollection;
  controllers?: MetadataCollection;
  exports?: MetadataCollection;
  middleware?: MetadataCollection;
  global?: boolean;
}

export interface ControllerMetadata {
  basePath: string;
  guards?: MetadataCollection;
  interceptors?: MetadataCollection;
  version?: string;
}

export interface RouteMetadata {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  path: string;
  request?: new (...args: never[]) => unknown;
  guards?: MetadataCollection;
  interceptors?: MetadataCollection;
  successStatus?: number;
  version?: string;
}

export interface DtoFieldBindingMetadata {
  source: MetadataSource;
  key?: string;
  optional?: boolean;
}

export interface ValidationIssueMetadata {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

export type ValidationRuleResult = boolean | void | ValidationIssueMetadata | readonly ValidationIssueMetadata[];

export interface ValidationDecoratorOptions {
  code?: string;
  each?: boolean;
  message?: string;
}

export interface CustomValidationDecoratorOptions extends ValidationDecoratorOptions {
  source?: MetadataSource;
}

export interface CustomFieldValidationContext<T = unknown> {
  dto: T;
  propertyKey: MetadataPropertyKey;
}

export type CustomFieldValidator<T = unknown> = (
  value: unknown,
  context: CustomFieldValidationContext<T>,
) => MaybePromise<ValidationRuleResult>;

export type CustomClassValidator<T = unknown> = (value: T) => MaybePromise<ValidationRuleResult>;

export type ConditionalFieldValidator<T = unknown> = (
  dto: T,
  value: unknown,
) => MaybePromise<boolean>;

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

export interface ClassValidationRule {
  code?: string;
  message?: string;
  validate: CustomClassValidator;
}

export interface InjectionMetadata {
  token: unknown;
  optional?: boolean;
}

export interface ClassDiMetadata {
  inject?: readonly Token[];
  scope?: 'singleton' | 'request' | 'transient';
}

export interface DtoBindingSchemaEntry {
  propertyKey: MetadataPropertyKey;
  metadata: DtoFieldBindingMetadata;
}

export interface DtoValidationSchemaEntry {
  propertyKey: MetadataPropertyKey;
  rules: readonly DtoFieldValidationRule[];
}

export interface InjectionSchemaEntry {
  propertyKey: MetadataPropertyKey;
  metadata: InjectionMetadata;
}

export interface StandardRouteMetadataRecord {
  guards?: MetadataCollection;
  interceptors?: MetadataCollection;
  method?: RouteMetadata['method'];
  path?: string;
  request?: new (...args: never[]) => unknown;
  successStatus?: number;
  version?: string;
}

export type StandardDtoBindingRecord = Partial<DtoFieldBindingMetadata>;
export type StandardDtoValidationRecord = DtoFieldValidationRule[];
export type StandardInjectionRecord = Partial<InjectionMetadata>;
