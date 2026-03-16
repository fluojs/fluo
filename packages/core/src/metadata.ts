import type { Constructor, MaybePromise, MetadataPropertyKey, MetadataSource, Token } from './types.js';

export interface ModuleMetadata {
  imports?: unknown[];
  providers?: unknown[];
  controllers?: unknown[];
  exports?: unknown[];
  middleware?: unknown[];
  global?: boolean;
}

export interface ControllerMetadata {
  basePath: string;
  guards?: unknown[];
  interceptors?: unknown[];
}

export interface RouteMetadata {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  path: string;
  request?: new (...args: never[]) => unknown;
  guards?: unknown[];
  interceptors?: unknown[];
  successStatus?: number;
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
  | ({ kind: 'nested'; dto: Constructor } & ValidationDecoratorOptions)
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
  inject?: Token[];
  scope?: 'singleton' | 'request' | 'transient';
}

type StandardMetadataBag = Record<PropertyKey, unknown>;

const symbolWithMetadata = Symbol as typeof Symbol & { metadata?: symbol };
export const metadataSymbol = symbolWithMetadata.metadata ?? Symbol.for('konekti.symbol.metadata');

if (!symbolWithMetadata.metadata) {
  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: metadataSymbol,
  });
}

const standardControllerMetadataKey = Symbol.for('konekti.standard.controller');
const standardRouteMetadataKey = Symbol.for('konekti.standard.route');
const standardDtoBindingMetadataKey = Symbol.for('konekti.standard.dto-binding');
const standardDtoValidationMetadataKey = Symbol.for('konekti.standard.dto-validation');
const standardInjectionMetadataKey = Symbol.for('konekti.standard.injection');
const standardClassValidationMetadataKey = Symbol.for('konekti.standard.class-validation');

interface StandardRouteMetadataRecord {
  guards?: unknown[];
  interceptors?: unknown[];
  method?: RouteMetadata['method'];
  path?: string;
  request?: new (...args: never[]) => unknown;
  successStatus?: number;
}

type StandardDtoBindingRecord = Partial<DtoFieldBindingMetadata>;
type StandardDtoValidationRecord = DtoFieldValidationRule[];

type StandardInjectionRecord = Partial<InjectionMetadata>;

export const metadataKeys = {
  module: Symbol.for('konekti.metadata.module'),
  controller: Symbol.for('konekti.metadata.controller'),
  route: Symbol.for('konekti.metadata.route'),
  dtoFieldBinding: Symbol.for('konekti.metadata.dto-field-binding'),
  dtoFieldValidation: Symbol.for('konekti.metadata.dto-field-validation'),
  injection: Symbol.for('konekti.metadata.injection'),
  classDi: Symbol.for('konekti.metadata.class-di'),
  classValidation: Symbol.for('konekti.metadata.class-validation'),
} as const;

const moduleMetadataStore = new WeakMap<Function, ModuleMetadata>();
const controllerMetadataStore = new WeakMap<Function, ControllerMetadata>();
const routeMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, RouteMetadata>>();
const dtoFieldBindingStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldBindingMetadata>>();
const dtoFieldValidationStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldValidationRule[]>>();
const injectionMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, InjectionMetadata>>();
const classDiMetadataStore = new WeakMap<Function, ClassDiMetadata>();
const classValidationStore = new WeakMap<Function, ClassValidationRule[]>();

function cloneModuleMetadata(metadata: ModuleMetadata): ModuleMetadata {
  return {
    controllers: metadata.controllers ? [...metadata.controllers] : undefined,
    exports: metadata.exports ? [...metadata.exports] : undefined,
    global: metadata.global,
    imports: metadata.imports ? [...metadata.imports] : undefined,
    middleware: metadata.middleware ? [...metadata.middleware] : undefined,
    providers: metadata.providers ? [...metadata.providers] : undefined,
  };
}

function cloneClassDiMetadata(metadata: ClassDiMetadata): ClassDiMetadata {
  return {
    inject: metadata.inject ? [...metadata.inject] : undefined,
    scope: metadata.scope,
  };
}

/**
 * 가드와 인터셉터 배열까지 복사해 route 메타데이터를 안전하게 복제한다.
 */
function cloneRouteMetadata(metadata: RouteMetadata): RouteMetadata {
  return {
    ...metadata,
    guards: metadata.guards ? [...metadata.guards] : undefined,
    interceptors: metadata.interceptors ? [...metadata.interceptors] : undefined,
  };
}

/**
 * 특정 대상에 연결된 속성별 메타데이터 맵을 가져오고, 없으면 새로 만든다.
 */
function getOrCreatePropertyMap<T>(
  store: WeakMap<object, Map<MetadataPropertyKey, T>>,
  target: object,
): Map<MetadataPropertyKey, T> {
  let map = store.get(target);

  if (!map) {
    map = new Map<MetadataPropertyKey, T>();
    store.set(target, map);
  }

  return map;
}

function mergeUnique<T>(existing: T[] | undefined, values: T[] | undefined): T[] | undefined {
  if (!existing?.length && !values?.length) {
    return undefined;
  }

  const merged = [...(existing ?? [])];

  for (const value of values ?? []) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }

  return merged;
}

function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  return (target as Record<symbol, StandardMetadataBag | undefined>)[metadataSymbol];
}

function getStandardControllerMetadata(target: Function): ControllerMetadata | undefined {
  const metadata = getStandardMetadataBag(target)?.[standardControllerMetadataKey] as ControllerMetadata | undefined;

  if (!metadata) {
    return undefined;
  }

  return {
    basePath: metadata.basePath,
    guards: metadata.guards ? [...metadata.guards] : undefined,
    interceptors: metadata.interceptors ? [...metadata.interceptors] : undefined,
  };
}

function getStandardRouteMetadata(target: object, propertyKey: MetadataPropertyKey): RouteMetadata | undefined {
  const constructor = (target as { constructor?: Function }).constructor;
  const routeMap = constructor
    ? (getStandardMetadataBag(constructor)?.[standardRouteMetadataKey] as
        | Map<MetadataPropertyKey, StandardRouteMetadataRecord>
        | undefined)
    : undefined;
  const metadata = routeMap?.get(propertyKey);

  if (!metadata?.method || metadata.path === undefined) {
    return undefined;
  }

  return {
    guards: metadata.guards ? [...metadata.guards] : undefined,
    interceptors: metadata.interceptors ? [...metadata.interceptors] : undefined,
    method: metadata.method,
    path: metadata.path,
    request: metadata.request,
    successStatus: metadata.successStatus,
  };
}

function getStandardDtoBindingMap(target: object): Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardDtoBindingMetadataKey] as
        | Map<MetadataPropertyKey, StandardDtoBindingRecord>
        | undefined)
    : undefined;
}

function getStandardDtoValidationMap(target: object): Map<MetadataPropertyKey, StandardDtoValidationRecord> | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardDtoValidationMetadataKey] as
        | Map<MetadataPropertyKey, StandardDtoValidationRecord>
        | undefined)
    : undefined;
}

function getStandardClassValidationRules(target: Function): ClassValidationRule[] | undefined {
  const rules = getStandardMetadataBag(target)?.[standardClassValidationMetadataKey] as ClassValidationRule[] | undefined;

  return rules ? [...rules] : undefined;
}

function getStandardInjectionMap(target: object): Map<MetadataPropertyKey, StandardInjectionRecord> | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  return constructor
    ? (getStandardMetadataBag(constructor)?.[standardInjectionMetadataKey] as
        | Map<MetadataPropertyKey, StandardInjectionRecord>
        | undefined)
    : undefined;
}

/**
 * 모듈 클래스에 모듈 메타데이터를 저장한다.
 */
export function defineModuleMetadata(target: Function, metadata: ModuleMetadata): void {
  const existing = moduleMetadataStore.get(target);

  moduleMetadataStore.set(target, {
    imports: metadata.imports ? [...metadata.imports] : existing?.imports ? [...existing.imports] : undefined,
    providers: metadata.providers ? [...metadata.providers] : existing?.providers ? [...existing.providers] : undefined,
    controllers: metadata.controllers ? [...metadata.controllers] : existing?.controllers ? [...existing.controllers] : undefined,
    exports: metadata.exports ? [...metadata.exports] : existing?.exports ? [...existing.exports] : undefined,
    middleware: metadata.middleware ? [...metadata.middleware] : existing?.middleware ? [...existing.middleware] : undefined,
    global: metadata.global ?? existing?.global,
  });
}

/**
 * 모듈 클래스에서 정규화된 모듈 메타데이터를 읽는다.
 */
export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  const metadata = moduleMetadataStore.get(target);

  return metadata ? cloneModuleMetadata(metadata) : undefined;
}

export function defineClassDiMetadata(target: Function, metadata: ClassDiMetadata): void {
  const existing = classDiMetadataStore.get(target);

  classDiMetadataStore.set(
    target,
    cloneClassDiMetadata({
      inject: metadata.inject ?? existing?.inject,
      scope: metadata.scope ?? existing?.scope,
    }),
  );
}

export function getOwnClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  const metadata = classDiMetadataStore.get(target);

  return metadata ? cloneClassDiMetadata(metadata) : undefined;
}

export function getClassDiMetadata(target: Function): ClassDiMetadata | undefined {
  return getOwnClassDiMetadata(target);
}

/**
 * 컨트롤러 클래스에 컨트롤러 레벨 메타데이터를 저장한다.
 */
export function defineControllerMetadata(target: Function, metadata: ControllerMetadata): void {
  controllerMetadataStore.set(target, {
    ...metadata,
    guards: metadata.guards ? [...metadata.guards] : undefined,
    interceptors: metadata.interceptors ? [...metadata.interceptors] : undefined,
  });
}

/**
 * 컨트롤러 클래스에서 정규화된 컨트롤러 메타데이터를 읽는다.
 */
export function getControllerMetadata(target: Function): ControllerMetadata | undefined {
  const stored = controllerMetadataStore.get(target);
  const standard = getStandardControllerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return {
    basePath: stored?.basePath ?? standard?.basePath ?? '',
    guards: mergeUnique(stored?.guards, standard?.guards),
    interceptors: mergeUnique(stored?.interceptors, standard?.interceptors),
  };
}

/**
 * 컨트롤러 프로토타입 메서드에 라우트 메타데이터를 저장한다.
 */
export function defineRouteMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: RouteMetadata,
): void {
  getOrCreatePropertyMap(routeMetadataStore, target).set(propertyKey, cloneRouteMetadata(metadata));
}

/**
 * 컨트롤러 프로토타입 메서드에서 정규화된 라우트 메타데이터를 읽는다.
 */
export function getRouteMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
): RouteMetadata | undefined {
  const stored = routeMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardRouteMetadata(target, propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  const method = stored?.method ?? standard?.method;
  const path = stored?.path ?? standard?.path;

  if (method === undefined || path === undefined) {
    throw new Error(`Route metadata for property key "${String(propertyKey)}" is missing required "method" or "path".`);
  }

  return {
    guards: mergeUnique(stored?.guards, standard?.guards),
    interceptors: mergeUnique(stored?.interceptors, standard?.interceptors),
    method,
    path,
    request: stored?.request ?? standard?.request,
    successStatus: stored?.successStatus ?? standard?.successStatus,
  };
}

/**
 * DTO 프로토타입 필드에 저장된 개별 바인딩 메타데이터를 읽는다.
 */
export function getDtoFieldBindingMetadata(target: object, propertyKey: MetadataPropertyKey): DtoFieldBindingMetadata | undefined {
  const stored = dtoFieldBindingStore.get(target)?.get(propertyKey);
  const standard = getStandardDtoBindingMap(target)?.get(propertyKey);

  if (!stored && !standard?.source) {
    return undefined;
  }

  return {
    key: stored?.key ?? standard?.key,
    optional: stored?.optional ?? standard?.optional,
    source: stored?.source ?? standard!.source!,
  };
}

/**
 * DTO 프로토타입 필드에 바인딩 메타데이터를 저장한다.
 */
export function defineDtoFieldBindingMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: DtoFieldBindingMetadata,
): void {
  getOrCreatePropertyMap(dtoFieldBindingStore, target).set(propertyKey, { ...metadata });
}

export function appendDtoFieldValidationRule(
  target: object,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  const map = getOrCreatePropertyMap(dtoFieldValidationStore, target);
  map.set(propertyKey, [...(map.get(propertyKey) ?? []), rule]);
}

export function appendClassValidationRule(target: Function, rule: ClassValidationRule): void {
  classValidationStore.set(target, [...(classValidationStore.get(target) ?? []), rule]);
}

/**
 * 클래스 필드에 주입 메타데이터를 저장한다.
 */
export function defineInjectionMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: InjectionMetadata,
): void {
  getOrCreatePropertyMap(injectionMetadataStore, target).set(propertyKey, { ...metadata });
}

/**
 * 저장된 필드 메타데이터로부터 정규화된 DTO 바인딩 스키마를 만든다.
 */
export function getDtoBindingSchema(dto: new (...args: never[]) => unknown) {
  const stored = dtoFieldBindingStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldBindingMetadata>();
  const standard =
    (getStandardMetadataBag(dto)?.[standardDtoBindingMetadataKey] as Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined) ??
    new Map<MetadataPropertyKey, StandardDtoBindingRecord>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      propertyKey,
      metadata: getDtoFieldBindingMetadata(dto.prototype, propertyKey),
    }))
    .filter(
      (entry): entry is { propertyKey: MetadataPropertyKey; metadata: DtoFieldBindingMetadata } => entry.metadata !== undefined,
    );
}

export function getDtoFieldValidationRules(target: object, propertyKey: MetadataPropertyKey): readonly DtoFieldValidationRule[] {
  const stored = dtoFieldValidationStore.get(target)?.get(propertyKey) ?? [];
  const standard = getStandardDtoValidationMap(target)?.get(propertyKey) ?? [];

  return [...standard, ...stored];
}

export function getDtoValidationSchema(dto: new (...args: never[]) => unknown) {
  const stored = dtoFieldValidationStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldValidationRule[]>();
  const standard = getStandardDtoValidationMap(dto.prototype) ?? new Map<MetadataPropertyKey, StandardDtoValidationRecord>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);

  return Array.from(keys)
    .map((propertyKey) => ({
      propertyKey,
      rules: getDtoFieldValidationRules(dto.prototype, propertyKey),
    }))
    .filter((entry) => entry.rules.length > 0);
}

export function getClassValidationRules(target: Function): readonly ClassValidationRule[] {
  return [...(getStandardClassValidationRules(target) ?? []), ...(classValidationStore.get(target) ?? [])];
}

/**
 * 저장된 필드 메타데이터로부터 정규화된 주입 스키마를 만든다.
 */
export function getInjectionSchema(target: object) {
  const stored = injectionMetadataStore.get(target) ?? new Map<MetadataPropertyKey, InjectionMetadata>();
  const standard = getStandardInjectionMap(target) ?? new Map<MetadataPropertyKey, StandardInjectionRecord>();
  const keys = new Set<MetadataPropertyKey>([...stored.keys(), ...standard.keys()]);
  const schema: Array<{ propertyKey: MetadataPropertyKey; metadata: InjectionMetadata }> = [];

  for (const propertyKey of keys) {
    const metadata = stored.get(propertyKey);
    const standardMetadata = standard.get(propertyKey);

    if (!metadata && !standardMetadata?.token) {
      continue;
    }

    schema.push({
      propertyKey,
      metadata: {
        optional: metadata?.optional ?? standardMetadata?.optional,
        token: metadata?.token ?? standardMetadata!.token!,
      },
    });
  }

  return schema;
}
