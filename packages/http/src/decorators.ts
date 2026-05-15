import {
  type Constructor,
  type MetadataPropertyKey,
  type MetadataSource,
} from '@fluojs/core';
import {
  defineControllerMetadata,
  defineDtoFieldBindingMetadata,
  defineRouteMetadata,
  ensureMetadataSymbol,
  getControllerMetadata,
  getDtoFieldBindingMetadata,
  getRouteMetadata,
  getStandardMetadataBag as readStandardMetadataBag,
  type ControllerMetadata,
  type DtoFieldBindingMetadata,
  type RouteMetadata,
} from '@fluojs/core/internal';

import { validateRoutePath } from './route-path.js';
import type { ConverterLike, GuardLike, HttpMethod, InterceptorLike } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type LegacyClassDecoratorFn = (target: Function) => void;
type LegacyMethodDecoratorFn = (target: object, propertyKey: MetadataPropertyKey, descriptor?: PropertyDescriptor) => void;
type LegacyFieldDecoratorFn = (target: object, propertyKey: MetadataPropertyKey) => void;
type ClassDecoratorLike = StandardClassDecoratorFn;
type MethodDecoratorLike = StandardMethodDecoratorFn;
type ClassOrMethodDecoratorLike = StandardClassDecoratorFn & StandardMethodDecoratorFn;
type FieldDecoratorLike = StandardFieldDecoratorFn;

const standardControllerMetadataKey = Symbol.for('fluo.standard.controller');
const standardRouteMetadataKey = Symbol.for('fluo.standard.route');
const standardDtoBindingMetadataKey = Symbol.for('fluo.standard.dto-binding');

const legacyRouteMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, StandardRouteMetadataRecord>>();
const legacyDtoBindingMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, Partial<DtoFieldBindingMetadata>>>();

ensureMetadataSymbol();

interface StandardRouteMetadataRecord {
  guards?: GuardLike[];
  headers?: Array<{ name: string; value: string }>;
  interceptors?: InterceptorLike[];
  method?: HttpMethod;
  path?: string;
  produces?: string[];
  redirect?: { url: string; statusCode?: number };
  request?: Constructor;
  successStatus?: number;
  version?: string;
}

function normalizeProducesMediaTypes(mediaTypes: readonly string[]): string[] {
  const normalized: string[] = [];

  for (const mediaType of mediaTypes) {
    const value = mediaType.trim();

    if (!value || normalized.includes(value)) {
      continue;
    }

    normalized.push(value);
  }

  return normalized;
}

function mergeUnique<T>(existing: T[] | undefined, values: T[]): T[] {
  const merged = [...(existing ?? [])];

  for (const value of values) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }

  return merged;
}

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  return typeof metadata === 'object' && metadata !== null ? metadata as StandardMetadataBag : {};
}

function isStandardDecoratorContext(value: unknown): value is ClassDecoratorContext | ClassMethodDecoratorContext | ClassFieldDecoratorContext {
  return typeof value === 'object' && value !== null && 'kind' in value && 'name' in value;
}

function isMetadataPropertyKey(value: unknown): value is MetadataPropertyKey {
  return typeof value === 'string' || typeof value === 'symbol';
}

function getLegacyRouteRecord(target: object, propertyKey: MetadataPropertyKey): StandardRouteMetadataRecord {
  let routeMap = legacyRouteMetadataStore.get(target);

  if (!routeMap) {
    routeMap = new Map<MetadataPropertyKey, StandardRouteMetadataRecord>();
    legacyRouteMetadataStore.set(target, routeMap);
  }

  let record = routeMap.get(propertyKey);

  if (!record) {
    record = {};
    routeMap.set(propertyKey, record);
  }

  return record;
}

function flushLegacyRouteMetadata(target: object, propertyKey: MetadataPropertyKey, record: StandardRouteMetadataRecord): void {
  if (!record.method || record.path === undefined) {
    return;
  }

  const existing = getRouteMetadata(target, propertyKey);
  const metadata: RouteMetadata = {
    guards: mergeUnique(existing?.guards as GuardLike[] | undefined, record.guards ?? []),
    headers: record.headers ?? existing?.headers,
    interceptors: mergeUnique(existing?.interceptors as InterceptorLike[] | undefined, record.interceptors ?? []),
    method: record.method as RouteMetadata['method'],
    path: record.path,
    redirect: record.redirect ?? existing?.redirect,
    request: record.request ?? existing?.request,
    successStatus: record.successStatus ?? existing?.successStatus,
    version: record.version ?? existing?.version,
  };

  defineRouteMetadata(target, propertyKey, metadata);
}

function mergeLegacyRouteMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  partial: Partial<StandardRouteMetadataRecord>,
): void {
  const record = getLegacyRouteRecord(target, propertyKey);
  Object.assign(record, partial);
  flushLegacyRouteMetadata(target, propertyKey, record);
}

function defineLegacyControllerMetadata(target: Function, partial: Partial<ControllerMetadata>): void {
  const existing = getControllerMetadata(target);

  defineControllerMetadata(target, {
    basePath: partial.basePath ?? existing?.basePath ?? '',
    guards: partial.guards ?? existing?.guards,
    interceptors: partial.interceptors ?? existing?.interceptors,
    version: partial.version ?? existing?.version,
  });
}

function getLegacyDtoBindingRecord(target: object, propertyKey: MetadataPropertyKey): Partial<DtoFieldBindingMetadata> {
  let bindingMap = legacyDtoBindingMetadataStore.get(target);

  if (!bindingMap) {
    bindingMap = new Map<MetadataPropertyKey, Partial<DtoFieldBindingMetadata>>();
    legacyDtoBindingMetadataStore.set(target, bindingMap);
  }

  let record = bindingMap.get(propertyKey);

  if (!record) {
    record = {};
    bindingMap.set(propertyKey, record);
  }

  return record;
}

function mergeLegacyDtoBinding(
  target: object,
  propertyKey: MetadataPropertyKey,
  partial: Partial<DtoFieldBindingMetadata>,
): void {
  const record = getLegacyDtoBindingRecord(target, propertyKey);
  Object.assign(record, partial);

  const source = record.source ?? getDtoFieldBindingMetadata(target, propertyKey)?.source;

  if (!source) {
    return;
  }

  defineDtoFieldBindingMetadata(target, propertyKey, {
    converter: record.converter,
    key: record.key,
    optional: record.optional,
    source,
  });
}

function appendLegacyRouteHeader(target: object, propertyKey: MetadataPropertyKey, name: string, value: string): void {
  const record = getLegacyRouteRecord(target, propertyKey);
  record.headers = [...(record.headers ?? []), { name, value }];
  flushLegacyRouteMetadata(target, propertyKey, record);
}

function appendLegacyControllerGuards(target: Function, guards: GuardLike[]): void {
  const existing = getControllerMetadata(target);

  defineLegacyControllerMetadata(target, {
    guards: mergeUnique(existing?.guards as GuardLike[] | undefined, guards),
  });
}

function appendLegacyControllerInterceptors(target: Function, interceptors: InterceptorLike[]): void {
  const existing = getControllerMetadata(target);

  defineLegacyControllerMetadata(target, {
    interceptors: mergeUnique(existing?.interceptors as InterceptorLike[] | undefined, interceptors),
  });
}

function appendLegacyRouteGuards(target: object, propertyKey: MetadataPropertyKey, guards: GuardLike[]): void {
  const record = getLegacyRouteRecord(target, propertyKey);
  record.guards = mergeUnique(record.guards, guards);
  flushLegacyRouteMetadata(target, propertyKey, record);
}

function appendLegacyRouteInterceptors(target: object, propertyKey: MetadataPropertyKey, interceptors: InterceptorLike[]): void {
  const record = getLegacyRouteRecord(target, propertyKey);
  record.interceptors = mergeUnique(record.interceptors, interceptors);
  flushLegacyRouteMetadata(target, propertyKey, record);
}

function getStandardControllerRecord(metadata: unknown): Partial<ControllerMetadata> {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardControllerMetadataKey] as Partial<ControllerMetadata> | undefined;

  if (current) {
    return current;
  }

  const created: Partial<ControllerMetadata> = {};
  bag[standardControllerMetadataKey] = created;
  return created;
}

function getStandardRouteMap(metadata: unknown): Map<MetadataPropertyKey, StandardRouteMetadataRecord> {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardRouteMetadataKey] as Map<MetadataPropertyKey, StandardRouteMetadataRecord> | undefined;

  if (current) {
    return current;
  }

  const created = new Map<MetadataPropertyKey, StandardRouteMetadataRecord>();
  bag[standardRouteMetadataKey] = created;
  return created;
}

function getStandardRouteRecord(metadata: unknown, propertyKey: MetadataPropertyKey): StandardRouteMetadataRecord {
  const routeMap = getStandardRouteMap(metadata);
  const current = routeMap.get(propertyKey);

  if (current) {
    return current;
  }

  const created: StandardRouteMetadataRecord = {};
  routeMap.set(propertyKey, created);
  return created;
}

function getStandardDtoBindingMap(metadata: unknown): Map<MetadataPropertyKey, Partial<DtoFieldBindingMetadata>> {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardDtoBindingMetadataKey] as Map<MetadataPropertyKey, Partial<DtoFieldBindingMetadata>> | undefined;

  if (current) {
    return current;
  }

  const created = new Map<MetadataPropertyKey, Partial<DtoFieldBindingMetadata>>();
  bag[standardDtoBindingMetadataKey] = created;
  return created;
}

function mergeStandardDtoBinding(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  partial: Partial<DtoFieldBindingMetadata>,
): void {
  const map = getStandardDtoBindingMap(metadata);
  map.set(propertyKey, {
    ...map.get(propertyKey),
    ...partial,
  });
}

function createRouteDecorator(method: HttpMethod, produces?: readonly string[]) {
  return (path: string): MethodDecoratorLike => {
    validateRoutePath(path, `@${method}() path`);

    const decorator = (valueOrTarget: Function | object, contextOrPropertyKey: ClassMethodDecoratorContext | MetadataPropertyKey) => {
      if (isStandardDecoratorContext(contextOrPropertyKey)) {
        const route = getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name);
        route.method = method;
        route.path = path;
        if (produces) {
          route.produces = normalizeProducesMediaTypes(produces);
        }
        return;
      }

      if (isMetadataPropertyKey(contextOrPropertyKey)) {
        const routeMetadata: Partial<StandardRouteMetadataRecord> = { method, path };
        if (produces) {
          routeMetadata.produces = normalizeProducesMediaTypes(produces);
        }
        mergeLegacyRouteMetadata(valueOrTarget, contextOrPropertyKey, routeMetadata);
      }
    };

    return decorator as MethodDecoratorLike & LegacyMethodDecoratorFn;
  };
}

function createRouteValueDecorator<T>(apply: (record: StandardRouteMetadataRecord, value: T) => void) {
  return (value: T): MethodDecoratorLike => {
    const decorator = (valueOrTarget: Function | object, contextOrPropertyKey: ClassMethodDecoratorContext | MetadataPropertyKey) => {
      if (isStandardDecoratorContext(contextOrPropertyKey)) {
        apply(getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name), value);
        return;
      }

      if (isMetadataPropertyKey(contextOrPropertyKey)) {
        const record = getLegacyRouteRecord(valueOrTarget, contextOrPropertyKey);
        apply(record, value);
        flushLegacyRouteMetadata(valueOrTarget, contextOrPropertyKey, record);
      }
    };

    return decorator as MethodDecoratorLike & LegacyMethodDecoratorFn;
  };
}

function createDtoFieldDecorator(source: MetadataSource) {
  return (key?: string): FieldDecoratorLike => {
    const decorator = <This, Value>(valueOrTarget: undefined | object, contextOrPropertyKey: ClassFieldDecoratorContext<This, Value> | MetadataPropertyKey) => {
      if (isStandardDecoratorContext(contextOrPropertyKey)) {
        mergeStandardDtoBinding(contextOrPropertyKey.metadata, contextOrPropertyKey.name, {
          key,
          source,
        });
        return;
      }

      if (isMetadataPropertyKey(contextOrPropertyKey) && valueOrTarget && typeof valueOrTarget === 'object') {
        mergeLegacyDtoBinding(valueOrTarget, contextOrPropertyKey, {
          key,
          source,
        });
      }
    };

    return decorator as FieldDecoratorLike & LegacyFieldDecoratorFn;
  };
}

/**
 * Marks a class as an HTTP controller and defines its base route path.
 *
 * @param basePath Controller base path prefixed to every route declared on the class.
 * @returns A class decorator that writes controller metadata for route mapping.
 */
export function Controller(basePath = ''): ClassDecoratorLike {
  validateRoutePath(basePath, '@Controller() base path');

  const decorator = (target: Function, context?: ClassDecoratorContext) => {
    if (isStandardDecoratorContext(context)) {
      getStandardControllerRecord(context.metadata).basePath = basePath;
      return;
    }

    defineLegacyControllerMetadata(target, { basePath });
  };

  return decorator as ClassDecoratorLike & LegacyClassDecoratorFn;
}

/**
 * Sets API version metadata on a controller or route handler.
 *
 * @param version Version label interpreted by runtime versioning strategy (for example `"1"`).
 * @returns A decorator that applies version metadata at class or method scope.
 */
export function Version(version: string): ClassOrMethodDecoratorLike {
  const decorator = (target: Function | object, contextOrPropertyKey?: ClassDecoratorContext | ClassMethodDecoratorContext | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      if (contextOrPropertyKey.kind === 'class') {
        getStandardControllerRecord(contextOrPropertyKey.metadata).version = version;
        return;
      }

      getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name).version = version;
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      mergeLegacyRouteMetadata(target, contextOrPropertyKey, { version });
      return;
    }

    if (typeof target === 'function') {
      defineLegacyControllerMetadata(target, { version });
    }
  };

  return decorator as ClassOrMethodDecoratorLike & LegacyClassDecoratorFn & LegacyMethodDecoratorFn;
}

/**
 * Registers a `GET` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `GET` handler mapping.
 */
export const Get = createRouteDecorator('GET');
/**
 * Registers a server-sent events route handler as `GET` with `text/event-stream` produces metadata.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `GET` SSE handler mapping.
 *
 * @remarks
 * This Phase 1 decorator only declares route and produced media-type metadata. Handlers remain responsible for creating and returning `SseResponse`.
 */
export const Sse = createRouteDecorator('GET', ['text/event-stream']);
/**
 * Registers a `POST` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `POST` handler mapping.
 */
export const Post = createRouteDecorator('POST');
/**
 * Registers a `PUT` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `PUT` handler mapping.
 */
export const Put = createRouteDecorator('PUT');
/**
 * Registers a `PATCH` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `PATCH` handler mapping.
 */
export const Patch = createRouteDecorator('PATCH');
/**
 * Registers a `DELETE` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `DELETE` handler mapping.
 */
export const Delete = createRouteDecorator('DELETE');
/**
 * Registers an `OPTIONS` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers an `OPTIONS` handler mapping.
 */
export const Options = createRouteDecorator('OPTIONS');
/**
 * Registers a `HEAD` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `HEAD` handler mapping.
 */
export const Head = createRouteDecorator('HEAD');
/**
 * Registers a route handler that matches all HTTP methods.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers an all-method handler mapping.
 */
export const All = createRouteDecorator('ALL');

/**
 * Associates a DTO class used for request binding and validation.
 *
 * @param dto DTO class consumed by request binding and validation.
 * @returns A method decorator that stores request DTO metadata for the route.
 */
export const RequestDto = createRouteValueDecorator<Constructor>((record, dto) => {
  record.request = dto;
});

/**
 * Declares response media types produced by a route handler.
 *
 * @param mediaTypes One or more media type strings written into route metadata.
 * @returns A method decorator that stores normalized `produces` metadata.
 */
export function Produces(...mediaTypes: string[]): MethodDecoratorLike {
  return createRouteValueDecorator<string[]>((record, value) => {
    record.produces = normalizeProducesMediaTypes(value);
  })(mediaTypes);
}

/**
 * Overrides the default success status code for a route handler.
 *
 * @param status HTTP status code used when the route completes successfully.
 * @returns A method decorator that stores the route-level success status override.
 */
export const HttpCode = createRouteValueDecorator<number>((record, status) => {
  record.successStatus = status;
});

/**
 * Reads route-level `@Produces(...)` metadata from a controller method.
 *
 * @param controllerToken Controller class containing route metadata.
 * @param propertyKey Controller method key to read.
 * @returns A defensive copy of declared media types, or `undefined` when not configured.
 */
export function getRouteProducesMetadata(controllerToken: Constructor, propertyKey: MetadataPropertyKey): string[] | undefined {
  const bag = readStandardMetadataBag(controllerToken);
  const routeMap = bag?.[standardRouteMetadataKey] as Map<MetadataPropertyKey, StandardRouteMetadataRecord> | undefined;
  const produces = routeMap?.get(propertyKey)?.produces ?? legacyRouteMetadataStore.get(controllerToken.prototype)?.get(propertyKey)?.produces;

  return produces ? [...produces] : undefined;
}

/**
 * Binds a DTO field from a path parameter.
 *
 * @param key Optional source key override. Defaults to the DTO field name.
 * @returns A field decorator that marks the binding source as `path`.
 */
export const FromPath = createDtoFieldDecorator('path');
/**
 * Binds a DTO field from query parameters.
 *
 * @param key Optional source key override. Defaults to the DTO field name.
 * @returns A field decorator that marks the binding source as `query`.
 */
export const FromQuery = createDtoFieldDecorator('query');
/**
 * Binds a DTO field from a request header.
 *
 * @param key Optional source key override. Defaults to the DTO field name.
 * @returns A field decorator that marks the binding source as `header`.
 */
export const FromHeader = createDtoFieldDecorator('header');
/**
 * Binds a DTO field from a cookie.
 *
 * @param key Optional source key override. Defaults to the DTO field name.
 * @returns A field decorator that marks the binding source as `cookie`.
 */
export const FromCookie = createDtoFieldDecorator('cookie');
/**
 * Binds a DTO field from the request body.
 *
 * @param key Optional source key override. Defaults to the DTO field name.
 * @returns A field decorator that marks the binding source as `body`.
 */
export const FromBody = createDtoFieldDecorator('body');

/**
 * Marks a DTO field binding as optional.
 *
 * @returns A field decorator that marks the DTO binding as optional.
 */
export function Optional(): FieldDecoratorLike {
  const decorator = <This, Value>(valueOrTarget: undefined | object, contextOrPropertyKey: ClassFieldDecoratorContext<This, Value> | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      mergeStandardDtoBinding(contextOrPropertyKey.metadata, contextOrPropertyKey.name, { optional: true });
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey) && valueOrTarget && typeof valueOrTarget === 'object') {
      mergeLegacyDtoBinding(valueOrTarget, contextOrPropertyKey, { optional: true });
    }
  };

  return decorator as FieldDecoratorLike & LegacyFieldDecoratorFn;
}

/**
 * Applies a field-level converter to a DTO binding.
 *
 * @param converter Converter instance or token resolved during request binding.
 * @returns A field decorator that stores converter metadata for the DTO field.
 */
export function Convert(converter: ConverterLike): FieldDecoratorLike {
  const decorator = <This, Value>(valueOrTarget: undefined | object, contextOrPropertyKey: ClassFieldDecoratorContext<This, Value> | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      mergeStandardDtoBinding(contextOrPropertyKey.metadata, contextOrPropertyKey.name, { converter });
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey) && valueOrTarget && typeof valueOrTarget === 'object') {
      mergeLegacyDtoBinding(valueOrTarget, contextOrPropertyKey, { converter });
    }
  };

  return decorator as FieldDecoratorLike & LegacyFieldDecoratorFn;
}

/**
 * Adds a static response header to the route metadata.
 *
 * @param name Response header name.
 * @param value Static response header value applied by the dispatcher.
 * @returns A method decorator that appends route-level response-header metadata.
 */
export function Header(name: string, value: string): MethodDecoratorLike {
  const decorator = (valueOrTarget: Function | object, contextOrPropertyKey: ClassMethodDecoratorContext | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      const route = getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name);
      route.headers = [...(route.headers ?? []), { name, value }];
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      appendLegacyRouteHeader(valueOrTarget, contextOrPropertyKey, name, value);
    }
  };

  return decorator as MethodDecoratorLike & LegacyMethodDecoratorFn;
}

/**
 * Marks a route as a redirect with an optional status code.
 *
 * @param url Redirect target URL.
 * @param statusCode Optional explicit redirect status code.
 * @returns A method decorator that writes redirect metadata for the route.
 */
export function Redirect(url: string, statusCode?: number): MethodDecoratorLike {
  const decorator = (valueOrTarget: Function | object, contextOrPropertyKey: ClassMethodDecoratorContext | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name).redirect = { url, statusCode };
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      mergeLegacyRouteMetadata(valueOrTarget, contextOrPropertyKey, { redirect: { url, statusCode } });
    }
  };

  return decorator as MethodDecoratorLike & LegacyMethodDecoratorFn;
}

/**
 * Attaches guards to a controller or route handler.
 *
 * @param guards One or more guards merged into existing class- or route-level guard metadata.
 * @returns A decorator applicable to classes and methods.
 */
export function UseGuards(...guards: GuardLike[]): ClassOrMethodDecoratorLike {
  const decorator = (target: Function | object, contextOrPropertyKey?: ClassDecoratorContext | ClassMethodDecoratorContext | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      if (contextOrPropertyKey.kind === 'class') {
        const controller = getStandardControllerRecord(contextOrPropertyKey.metadata);
        controller.guards = mergeUnique(controller.guards as GuardLike[] | undefined, guards);
        return;
      }

      const route = getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name);
      route.guards = mergeUnique(route.guards, guards);
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      appendLegacyRouteGuards(target, contextOrPropertyKey, guards);
      return;
    }

    if (typeof target === 'function') {
      appendLegacyControllerGuards(target, guards);
    }
  };

  return decorator as ClassOrMethodDecoratorLike & LegacyClassDecoratorFn & LegacyMethodDecoratorFn;
}

/**
 * Attaches interceptors to a controller or route handler.
 *
 * @param interceptors One or more interceptors merged into existing class- or route-level metadata.
 * @returns A decorator applicable to classes and methods.
 */
export function UseInterceptors(...interceptors: InterceptorLike[]): ClassOrMethodDecoratorLike {
  const decorator = (target: Function | object, contextOrPropertyKey?: ClassDecoratorContext | ClassMethodDecoratorContext | MetadataPropertyKey) => {
    if (isStandardDecoratorContext(contextOrPropertyKey)) {
      if (contextOrPropertyKey.kind === 'class') {
        const controller = getStandardControllerRecord(contextOrPropertyKey.metadata);
        controller.interceptors = mergeUnique(controller.interceptors as InterceptorLike[] | undefined, interceptors);
        return;
      }

      const route = getStandardRouteRecord(contextOrPropertyKey.metadata, contextOrPropertyKey.name);
      route.interceptors = mergeUnique(route.interceptors, interceptors);
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      appendLegacyRouteInterceptors(target, contextOrPropertyKey, interceptors);
      return;
    }

    if (typeof target === 'function') {
      appendLegacyControllerInterceptors(target, interceptors);
    }
  };

  return decorator as ClassOrMethodDecoratorLike & LegacyClassDecoratorFn & LegacyMethodDecoratorFn;
}
