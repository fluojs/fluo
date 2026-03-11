import type { MetadataPropertyKey, MetadataSource } from './types';

export interface ModuleMetadata {
  imports?: unknown[];
  providers?: unknown[];
  controllers?: unknown[];
  exports?: unknown[];
  middleware?: unknown[];
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

export interface InjectionMetadata {
  token: unknown;
  optional?: boolean;
}

export const metadataKeys = {
  module: Symbol.for('konekti.metadata.module'),
  controller: Symbol.for('konekti.metadata.controller'),
  route: Symbol.for('konekti.metadata.route'),
  dtoFieldBinding: Symbol.for('konekti.metadata.dto-field-binding'),
  injection: Symbol.for('konekti.metadata.injection'),
} as const;

const moduleMetadataStore = new WeakMap<Function, ModuleMetadata>();
const controllerMetadataStore = new WeakMap<Function, ControllerMetadata>();
const routeMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, RouteMetadata>>();
const dtoFieldBindingStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldBindingMetadata>>();
const injectionMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, InjectionMetadata>>();

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

/**
 * 모듈 클래스에 모듈 메타데이터를 저장한다.
 */
export function defineModuleMetadata(target: Function, metadata: ModuleMetadata): void {
  moduleMetadataStore.set(target, {
    imports: metadata.imports ? [...metadata.imports] : undefined,
    providers: metadata.providers ? [...metadata.providers] : undefined,
    controllers: metadata.controllers ? [...metadata.controllers] : undefined,
    exports: metadata.exports ? [...metadata.exports] : undefined,
    middleware: metadata.middleware ? [...metadata.middleware] : undefined,
  });
}

/**
 * 모듈 클래스에서 정규화된 모듈 메타데이터를 읽는다.
 */
export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  const metadata = moduleMetadataStore.get(target);

  return metadata
    ? {
        imports: metadata.imports ? [...metadata.imports] : undefined,
        providers: metadata.providers ? [...metadata.providers] : undefined,
        controllers: metadata.controllers ? [...metadata.controllers] : undefined,
        exports: metadata.exports ? [...metadata.exports] : undefined,
        middleware: metadata.middleware ? [...metadata.middleware] : undefined,
      }
    : undefined;
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
  const metadata = controllerMetadataStore.get(target);

  return metadata
    ? {
        ...metadata,
        guards: metadata.guards ? [...metadata.guards] : undefined,
        interceptors: metadata.interceptors ? [...metadata.interceptors] : undefined,
      }
    : undefined;
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
  const metadata = routeMetadataStore.get(target)?.get(propertyKey);

  return metadata ? cloneRouteMetadata(metadata) : undefined;
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
  const map = dtoFieldBindingStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldBindingMetadata>();

  return Array.from(map.entries()).map(([propertyKey, metadata]) => ({
    propertyKey,
    metadata: { ...metadata },
  }));
}

/**
 * 저장된 필드 메타데이터로부터 정규화된 주입 스키마를 만든다.
 */
export function getInjectionSchema(target: object) {
  const map = injectionMetadataStore.get(target) ?? new Map<MetadataPropertyKey, InjectionMetadata>();

  return Array.from(map.entries()).map(([propertyKey, metadata]) => ({
    propertyKey,
    metadata: { ...metadata },
  }));
}
