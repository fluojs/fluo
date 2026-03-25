import {
  metadataSymbol,
  type Constructor,
  type ControllerMetadata,
  type DtoFieldBindingMetadata,
  type MetadataPropertyKey,
  type MetadataSource,
} from '@konekti/core';

import type { GuardLike, HttpMethod, InterceptorLike } from './types.js';

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

export function Controller(basePath = ''): ClassDecoratorLike {
  const decorator = (_target: Function, context: ClassDecoratorContext) => {
    getStandardControllerRecord(context.metadata).basePath = basePath;
  };

  return decorator as ClassDecoratorLike;
}

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

export const Get = createRouteDecorator('GET');
export const Post = createRouteDecorator('POST');
export const Put = createRouteDecorator('PUT');
export const Patch = createRouteDecorator('PATCH');
export const Delete = createRouteDecorator('DELETE');
export const Options = createRouteDecorator('OPTIONS');
export const Head = createRouteDecorator('HEAD');
export const All = createRouteDecorator('ALL');

export const RequestDto = createRouteValueDecorator<Constructor>((record, dto) => {
  record.request = dto;
});

export function Produces(...mediaTypes: string[]): MethodDecoratorLike {
  return createRouteValueDecorator<string[]>((record, value) => {
    record.produces = normalizeProducesMediaTypes(value);
  })(mediaTypes);
}

export const HttpCode = createRouteValueDecorator<number>((record, status) => {
  record.successStatus = status;
});

export function getRouteProducesMetadata(controllerToken: Constructor, propertyKey: MetadataPropertyKey): string[] | undefined {
  const bag = (controllerToken as unknown as Record<PropertyKey, unknown>)[metadataSymbol] as StandardMetadataBag | undefined;
  const routeMap = bag?.[standardRouteMetadataKey] as Map<MetadataPropertyKey, StandardRouteMetadataRecord> | undefined;
  const produces = routeMap?.get(propertyKey)?.produces;

  return produces ? [...produces] : undefined;
}

export const FromPath = createDtoFieldDecorator('path');
export const FromQuery = createDtoFieldDecorator('query');
export const FromHeader = createDtoFieldDecorator('header');
export const FromCookie = createDtoFieldDecorator('cookie');
export const FromBody = createDtoFieldDecorator('body');

export function Optional(): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    mergeStandardDtoBinding(context.metadata, context.name, { optional: true });
  };

  return decorator as FieldDecoratorLike;
}

export function Header(name: string, value: string): MethodDecoratorLike {
  const decorator = (_target: Function, context: ClassMethodDecoratorContext) => {
    const route = getStandardRouteRecord(context.metadata, context.name);
    route.headers = [...(route.headers ?? []), { name, value }];
  };

  return decorator as MethodDecoratorLike;
}

export function Redirect(url: string, statusCode?: number): MethodDecoratorLike {
  const decorator = (_target: Function, context: ClassMethodDecoratorContext) => {
    getStandardRouteRecord(context.metadata, context.name).redirect = { url, statusCode };
  };

  return decorator as MethodDecoratorLike;
}

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
