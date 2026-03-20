import { cloneCollection, getOrCreatePropertyMap, getStandardMetadataBag, mergeUnique, standardMetadataKeys } from './shared.js';
import type { ControllerMetadata, RouteMetadata, StandardRouteMetadataRecord } from './types.js';
import type { MetadataPropertyKey } from '../types.js';

const controllerMetadataStore = new WeakMap<Function, ControllerMetadata>();
const routeMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, RouteMetadata>>();

function cloneControllerMetadata(metadata: ControllerMetadata): ControllerMetadata {
  return {
    ...metadata,
    guards: cloneCollection(metadata.guards),
    interceptors: cloneCollection(metadata.interceptors),
  };
}

function cloneRouteMetadata(metadata: RouteMetadata): RouteMetadata {
  return {
    ...metadata,
    guards: cloneCollection(metadata.guards),
    interceptors: cloneCollection(metadata.interceptors),
  };
}

function getStandardControllerMetadata(target: Function): ControllerMetadata | undefined {
  const metadata = getStandardMetadataBag(target)?.[standardMetadataKeys.controller] as ControllerMetadata | undefined;

  if (!metadata) {
    return undefined;
  }

  return cloneControllerMetadata(metadata);
}

function getStandardRouteMetadata(target: object, propertyKey: MetadataPropertyKey): RouteMetadata | undefined {
  const constructor = (target as { constructor?: Function }).constructor;
  const routeMap = constructor
    ? (getStandardMetadataBag(constructor)?.[standardMetadataKeys.route] as Map<MetadataPropertyKey, StandardRouteMetadataRecord> | undefined)
    : undefined;
  const metadata = routeMap?.get(propertyKey);

  if (!metadata?.method || metadata.path === undefined) {
    return undefined;
  }

  return cloneRouteMetadata({
    guards: metadata.guards,
    interceptors: metadata.interceptors,
    method: metadata.method,
    path: metadata.path,
    request: metadata.request,
    successStatus: metadata.successStatus,
    version: metadata.version,
  });
}

export function defineControllerMetadata(target: Function, metadata: ControllerMetadata): void {
  controllerMetadataStore.set(target, cloneControllerMetadata(metadata));
}

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
    version: stored?.version ?? standard?.version,
  };
}

export function defineRouteMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: RouteMetadata,
): void {
  getOrCreatePropertyMap(routeMetadataStore, target).set(propertyKey, cloneRouteMetadata(metadata));
}

export function getRouteMetadata(target: object, propertyKey: MetadataPropertyKey): RouteMetadata | undefined {
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
    version: stored?.version ?? standard?.version,
  };
}
