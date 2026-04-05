import {
  type Constructor,
  type MetadataPropertyKey,
  type MetadataSource,
} from '@konekti/core';
import {
  metadataSymbol,
  type ControllerMetadata,
  type DtoFieldBindingMetadata,
} from '@konekti/core/internal';

import type { ConverterLike, GuardLike, HttpMethod, InterceptorLike } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;
type ClassDecoratorLike = StandardClassDecoratorFn;
type MethodDecoratorLike = StandardMethodDecoratorFn;
type ClassOrMethodDecoratorLike = StandardClassDecoratorFn & StandardMethodDecoratorFn;
type FieldDecoratorLike = StandardFieldDecoratorFn;

const standardControllerMetadataKey = Symbol.for('konekti.standard.controller');
const standardRouteMetadataKey = Symbol.for('konekti.standard.route');
const standardDtoBindingMetadataKey = Symbol.for('konekti.standard.dto-binding');

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
  void metadataSymbol;
  return metadata as StandardMetadataBag;
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

function createRouteDecorator(method: HttpMethod) {
  return (path: string): MethodDecoratorLike => {
    const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
      const route = getStandardRouteRecord(context.metadata, context.name);
      route.method = method;
      route.path = path;
    };

    return decorator as MethodDecoratorLike;
  };
}

function createRouteValueDecorator<T>(apply: (record: StandardRouteMetadataRecord, value: T) => void) {
  return (value: T): MethodDecoratorLike => {
    const decorator = (_target: Function, context: ClassMethodDecoratorContext) => {
      apply(getStandardRouteRecord(context.metadata, context.name), value);
    };

    return decorator as MethodDecoratorLike;
  };
}

function createDtoFieldDecorator(source: MetadataSource) {
  return (key?: string): FieldDecoratorLike => {
    const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
      mergeStandardDtoBinding(context.metadata, context.name, {
        key,
        source,
      });
    };

    return decorator as FieldDecoratorLike;
  };
}

/**
 * Marks a class as an HTTP controller and defines its base route path.
 *
 * @param basePath Controller base path prefixed to every route declared on the class.
 * @returns A class decorator that writes controller metadata for route mapping.
 */
export function Controller(basePath = ''): ClassDecoratorLike {
  const decorator = (_target: Function, context: ClassDecoratorContext) => {
    getStandardControllerRecord(context.metadata).basePath = basePath;
  };

  return decorator as ClassDecoratorLike;
}

/**
 * Sets API version metadata on a controller or route handler.
 *
 * @param version Version label interpreted by runtime versioning strategy (for example `"1"`).
 * @returns A decorator that applies version metadata at class or method scope.
 */
export function Version(version: string): ClassOrMethodDecoratorLike {
  const decorator = (_target: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      getStandardControllerRecord(context.metadata).version = version;
      return;
    }

    getStandardRouteRecord(context.metadata, context.name).version = version;
  };

  return decorator as ClassOrMethodDecoratorLike;
}

/**
 * Registers a `GET` route handler.
 *
 * @param path Route path relative to the controller base path.
 * @returns A method decorator that registers a `GET` handler mapping.
 */
export const Get = createRouteDecorator('GET');
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
  const bag = (controllerToken as unknown as Record<PropertyKey, unknown>)[metadataSymbol] as StandardMetadataBag | undefined;
  const routeMap = bag?.[standardRouteMetadataKey] as Map<MetadataPropertyKey, StandardRouteMetadataRecord> | undefined;
  const produces = routeMap?.get(propertyKey)?.produces;

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
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    mergeStandardDtoBinding(context.metadata, context.name, { optional: true });
  };

  return decorator as FieldDecoratorLike;
}

/**
 * Applies a field-level converter to a DTO binding.
 *
 * @param converter Converter instance or token resolved during request binding.
 * @returns A field decorator that stores converter metadata for the DTO field.
 */
export function Convert(converter: ConverterLike): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    mergeStandardDtoBinding(context.metadata, context.name, { converter });
  };

  return decorator as FieldDecoratorLike;
}

/**
 * Adds a static response header to the route metadata.
 *
 * @param name Response header name.
 * @param value Static response header value applied by the dispatcher.
 * @returns A method decorator that appends route-level response-header metadata.
 */
export function Header(name: string, value: string): MethodDecoratorLike {
  const decorator = (_target: Function, context: ClassMethodDecoratorContext) => {
    const route = getStandardRouteRecord(context.metadata, context.name);
    route.headers = [...(route.headers ?? []), { name, value }];
  };

  return decorator as MethodDecoratorLike;
}

/**
 * Marks a route as a redirect with an optional status code.
 *
 * @param url Redirect target URL.
 * @param statusCode Optional explicit redirect status code.
 * @returns A method decorator that writes redirect metadata for the route.
 */
export function Redirect(url: string, statusCode?: number): MethodDecoratorLike {
  const decorator = (_target: Function, context: ClassMethodDecoratorContext) => {
    getStandardRouteRecord(context.metadata, context.name).redirect = { url, statusCode };
  };

  return decorator as MethodDecoratorLike;
}

/**
 * Attaches guards to a controller or route handler.
 *
 * @param guards One or more guards merged into existing class- or route-level guard metadata.
 * @returns A decorator applicable to classes and methods.
 */
export function UseGuards(...guards: GuardLike[]): ClassOrMethodDecoratorLike {
  const decorator = (_target: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      const controller = getStandardControllerRecord(context.metadata);
      controller.guards = mergeUnique(controller.guards as GuardLike[] | undefined, guards);
      return;
    }

    const route = getStandardRouteRecord(context.metadata, context.name);
    route.guards = mergeUnique(route.guards, guards);
  };

  return decorator as ClassOrMethodDecoratorLike;
}

/**
 * Attaches interceptors to a controller or route handler.
 *
 * @param interceptors One or more interceptors merged into existing class- or route-level metadata.
 * @returns A decorator applicable to classes and methods.
 */
export function UseInterceptors(...interceptors: InterceptorLike[]): ClassOrMethodDecoratorLike {
  const decorator = (_target: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      const controller = getStandardControllerRecord(context.metadata);
      controller.interceptors = mergeUnique(controller.interceptors as InterceptorLike[] | undefined, interceptors);
      return;
    }

    const route = getStandardRouteRecord(context.metadata, context.name);
    route.interceptors = mergeUnique(route.interceptors, interceptors);
  };

  return decorator as ClassOrMethodDecoratorLike;
}
