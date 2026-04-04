import {
  metadataSymbol,
  type Constructor,
  type ControllerMetadata,
  type DtoFieldBindingMetadata,
  type MetadataPropertyKey,
  type MetadataSource,
} from '@konekti/core';

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
 */
export function Controller(basePath = ''): ClassDecoratorLike {
  const decorator = (_target: Function, context: ClassDecoratorContext) => {
    getStandardControllerRecord(context.metadata).basePath = basePath;
  };

  return decorator as ClassDecoratorLike;
}

/**
 * Sets API version metadata on a controller or route handler.
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
 */
export const Get = createRouteDecorator('GET');
/**
 * Registers a `POST` route handler.
 */
export const Post = createRouteDecorator('POST');
/**
 * Registers a `PUT` route handler.
 */
export const Put = createRouteDecorator('PUT');
/**
 * Registers a `PATCH` route handler.
 */
export const Patch = createRouteDecorator('PATCH');
/**
 * Registers a `DELETE` route handler.
 */
export const Delete = createRouteDecorator('DELETE');
/**
 * Registers an `OPTIONS` route handler.
 */
export const Options = createRouteDecorator('OPTIONS');
/**
 * Registers a `HEAD` route handler.
 */
export const Head = createRouteDecorator('HEAD');
/**
 * Registers a route handler that matches all HTTP methods.
 */
export const All = createRouteDecorator('ALL');

/**
 * Associates a DTO class used for request binding and validation.
 */
export const RequestDto = createRouteValueDecorator<Constructor>((record, dto) => {
  record.request = dto;
});

/**
 * Declares response media types produced by a route handler.
 */
export function Produces(...mediaTypes: string[]): MethodDecoratorLike {
  return createRouteValueDecorator<string[]>((record, value) => {
    record.produces = normalizeProducesMediaTypes(value);
  })(mediaTypes);
}

/**
 * Overrides the default success status code for a route handler.
 */
export const HttpCode = createRouteValueDecorator<number>((record, status) => {
  record.successStatus = status;
});

/**
 * Reads route-level `@Produces(...)` metadata from a controller method.
 */
export function getRouteProducesMetadata(controllerToken: Constructor, propertyKey: MetadataPropertyKey): string[] | undefined {
  const bag = (controllerToken as unknown as Record<PropertyKey, unknown>)[metadataSymbol] as StandardMetadataBag | undefined;
  const routeMap = bag?.[standardRouteMetadataKey] as Map<MetadataPropertyKey, StandardRouteMetadataRecord> | undefined;
  const produces = routeMap?.get(propertyKey)?.produces;

  return produces ? [...produces] : undefined;
}

/**
 * Binds a DTO field from a path parameter.
 */
export const FromPath = createDtoFieldDecorator('path');
/**
 * Binds a DTO field from query parameters.
 */
export const FromQuery = createDtoFieldDecorator('query');
/**
 * Binds a DTO field from a request header.
 */
export const FromHeader = createDtoFieldDecorator('header');
/**
 * Binds a DTO field from a cookie.
 */
export const FromCookie = createDtoFieldDecorator('cookie');
/**
 * Binds a DTO field from the request body.
 */
export const FromBody = createDtoFieldDecorator('body');

/**
 * Marks a DTO field binding as optional.
 */
export function Optional(): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    mergeStandardDtoBinding(context.metadata, context.name, { optional: true });
  };

  return decorator as FieldDecoratorLike;
}

/**
 * Applies a field-level converter to a DTO binding.
 */
export function Convert(converter: ConverterLike): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    mergeStandardDtoBinding(context.metadata, context.name, { converter });
  };

  return decorator as FieldDecoratorLike;
}

/**
 * Adds a static response header to the route metadata.
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
 */
export function Redirect(url: string, statusCode?: number): MethodDecoratorLike {
  const decorator = (_target: Function, context: ClassMethodDecoratorContext) => {
    getStandardRouteRecord(context.metadata, context.name).redirect = { url, statusCode };
  };

  return decorator as MethodDecoratorLike;
}

/**
 * Attaches guards to a controller or route handler.
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
