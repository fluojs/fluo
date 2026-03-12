import {
  metadataSymbol,
  type Constructor,
  type ControllerMetadata,
  type DtoFieldBindingMetadata,
  type MetadataPropertyKey,
  type MetadataSource,
} from '@konekti/core';

import type { GuardLike, HttpMethod, InterceptorLike } from './types';

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
  interceptors?: InterceptorLike[];
  method?: HttpMethod;
  path?: string;
  request?: Constructor;
  successStatus?: number;
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

export const Get = createRouteDecorator('GET');
export const Post = createRouteDecorator('POST');
export const Put = createRouteDecorator('PUT');
export const Patch = createRouteDecorator('PATCH');
export const Delete = createRouteDecorator('DELETE');
export const Options = createRouteDecorator('OPTIONS');
export const Head = createRouteDecorator('HEAD');

export const RequestDto = createRouteValueDecorator<Constructor>((record, dto) => {
  record.request = dto;
});

export const SuccessStatus = createRouteValueDecorator<number>((record, status) => {
  record.successStatus = status;
});

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

export function UseGuard(...guards: GuardLike[]): ClassOrMethodDecoratorLike {
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

export function UseInterceptor(...interceptors: InterceptorLike[]): ClassOrMethodDecoratorLike {
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
