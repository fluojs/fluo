import { InvariantError } from '../errors.js';
import type { MetadataPropertyKey } from '../types.js';
import {
  cloneCollection,
  cloneMutableValue,
  getGlobalMetadataWeakMap,
  getOrCreatePropertyMap,
  getStandardConstructorMetadataMap,
  getStandardMetadataBag,
  mergeUnique,
  metadataKeys,
  standardMetadataKeys,
} from './shared.js';
import { createClonedWeakMapStore } from './store.js';
import type { ControllerMetadata, RouteMetadata, StandardRouteMetadataRecord } from './types.js';

const controllerMetadataStore = createClonedWeakMapStore<Function, ControllerMetadata>(
  cloneControllerMetadata,
  getGlobalMetadataWeakMap<Function, ControllerMetadata>(metadataKeys.controller),
);
const routeMetadataStore = getGlobalMetadataWeakMap<object, Map<MetadataPropertyKey, RouteMetadata>>(metadataKeys.route);

function cloneRouteHeaders(headers: RouteMetadata['headers']): RouteMetadata['headers'] {
  return headers?.map((header) => ({ ...header }));
}

function cloneRouteRedirect(redirect: RouteMetadata['redirect']): RouteMetadata['redirect'] {
  return redirect ? { ...redirect } : undefined;
}

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
    headers: cloneRouteHeaders(metadata.headers),
    redirect: cloneRouteRedirect(metadata.redirect),
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
  const routeMap = getStandardConstructorMetadataMap<StandardRouteMetadataRecord>(target, standardMetadataKeys.route);
  const metadata = routeMap?.get(propertyKey);

  if (!metadata?.method || metadata.path === undefined) {
    return undefined;
  }

  return cloneRouteMetadata({
    guards: metadata.guards,
    headers: metadata.headers,
    interceptors: metadata.interceptors,
    method: metadata.method,
    path: metadata.path,
    redirect: metadata.redirect,
    request: metadata.request,
    successStatus: metadata.successStatus,
    version: metadata.version,
  });
}

/**
 * Clone and replace the controller record stored on this exact target, without merging on write.
 * Guard and interceptor collections are copied while their entries retain their references.
 *
 * @param target Controller constructor whose own stored record is replaced.
 * @param metadata Complete controller record to copy into the store.
 */
export function defineControllerMetadata(target: Function, metadata: ControllerMetadata): void {
  controllerMetadataStore.write(target, metadata);
}

/**
 * Merge the exact target's stored controller record with standard metadata into a fresh mutable copy.
 * Stored records are not inherited through the prototype chain. Non-nullish stored basePath
 * and version take precedence; basePath defaults to ''. Guards and interceptors merge
 * stored-first and deduplicate by reference.
 *
 * @param target Controller constructor to inspect.
 * @returns A fresh merged record, or undefined when neither source has a record.
 */
export function getControllerMetadata(target: Function): ControllerMetadata | undefined {
  const stored = controllerMetadataStore.read(target);
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

/**
 * Clone and replace the route record for one property on this exact target, without merging on write.
 * Headers, redirect, and guard/interceptor collections are copied.
 *
 * @param target Object whose own route map receives the record.
 * @param propertyKey Route property whose previous stored record is replaced.
 * @param metadata Complete route record to copy into the store.
 */
export function defineRouteMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: RouteMetadata,
): void {
  getOrCreatePropertyMap(routeMetadataStore, target).set(propertyKey, cloneRouteMetadata(metadata));
}

function resolveRequiredRouteFields(
  stored: RouteMetadata | undefined,
  standard: RouteMetadata | undefined,
  propertyKey: MetadataPropertyKey,
): Pick<RouteMetadata, 'method' | 'path'> {
  const method = stored?.method ?? standard?.method;
  const path = stored?.path ?? standard?.path;

  if (method === undefined || path === undefined) {
    throw new InvariantError(`Route metadata for property key "${String(propertyKey)}" is missing required "method" or "path".`);
  }

  return { method, path };
}

function mergeRouteMetadata(
  stored: RouteMetadata | undefined,
  standard: RouteMetadata | undefined,
  required: Pick<RouteMetadata, 'method' | 'path'>,
): RouteMetadata {
  const mergedHeaders = stored?.headers ?? standard?.headers;
  const mergedRedirect = stored?.redirect ?? standard?.redirect;

  return {
    guards: mergeUnique(stored?.guards, standard?.guards),
    headers: cloneMutableValue(mergedHeaders),
    interceptors: mergeUnique(stored?.interceptors, standard?.interceptors),
    method: required.method,
    path: required.path,
    redirect: cloneMutableValue(mergedRedirect),
    request: stored?.request ?? standard?.request,
    successStatus: stored?.successStatus ?? standard?.successStatus,
    version: stored?.version ?? standard?.version,
  };
}

/**
 * Merge one route's stored and standard records into a fresh mutable copy.
 * Only this exact target's stored map is read, without prototype inheritance.
 * Non-nullish stored fields take precedence over standard fields; guards and interceptors
 * merge stored-first and deduplicate by reference. Headers and redirect are cloned.
 *
 * @param target Object whose route metadata is inspected.
 * @param propertyKey Route property to read from both sources.
 * @returns A fresh merged record, or undefined when neither source has a record.
 * @throws InvariantError when a present merged record lacks method or path.
 */
export function getRouteMetadata(target: object, propertyKey: MetadataPropertyKey): RouteMetadata | undefined {
  const stored = routeMetadataStore.get(target)?.get(propertyKey);
  const standard = getStandardRouteMetadata(target, propertyKey);

  if (!stored && !standard) {
    return undefined;
  }

  const required = resolveRequiredRouteFields(stored, standard, propertyKey);

  return mergeRouteMetadata(stored, standard, required);
}
