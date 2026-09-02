import type { MetadataPropertyKey } from '@fluojs/core';
import { getStandardMetadataBag } from '@fluojs/core/internal';

const runtimeRouteInspectionMetadataKey = Symbol.for('fluo.runtime.route-inspection');

const legacyRouteInspectionMetadataStore = new WeakMap<
  object,
  Map<MetadataPropertyKey, RuntimeRouteInspectionMetadata>
>();

/** Describes package-integration metadata that classifies a compiled runtime route. */
export interface RuntimeRouteInspectionMetadata {
  readonly kind: string;
}

function cloneMetadata(metadata: RuntimeRouteInspectionMetadata): RuntimeRouteInspectionMetadata {
  return Object.freeze({ kind: metadata.kind });
}

function getMetadataMap(metadata: unknown): Map<MetadataPropertyKey, RuntimeRouteInspectionMetadata> {
  const metadataBag = typeof metadata === 'object' && metadata !== null ? metadata : {};
  const current = Object.hasOwn(metadataBag, runtimeRouteInspectionMetadataKey)
    ? Reflect.get(metadataBag, runtimeRouteInspectionMetadataKey)
    : undefined;

  if (current instanceof Map) {
    return current;
  }

  const inherited = Reflect.get(metadataBag, runtimeRouteInspectionMetadataKey);
  const created = inherited instanceof Map
    ? new Map<MetadataPropertyKey, RuntimeRouteInspectionMetadata>(inherited)
    : new Map<MetadataPropertyKey, RuntimeRouteInspectionMetadata>();
  Reflect.set(metadataBag, runtimeRouteInspectionMetadataKey, created);
  return created;
}

/**
 * Records route inspection metadata in a TC39 standard decorator metadata bag.
 *
 * @param metadata Standard decorator metadata bag that owns the route marker.
 * @param propertyKey Controller method key associated with the route.
 * @param value Route inspection metadata to store as an immutable snapshot.
 */
export function defineStandardRuntimeRouteInspectionMetadata(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  value: RuntimeRouteInspectionMetadata,
): void {
  getMetadataMap(metadata).set(propertyKey, cloneMetadata(value));
}

/**
 * Records route inspection metadata for legacy decorator-call compatibility.
 *
 * @param target Controller prototype that owns the decorated route.
 * @param propertyKey Controller method key associated with the route.
 * @param value Route inspection metadata to store as an immutable snapshot.
 */
export function defineLegacyRuntimeRouteInspectionMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  value: RuntimeRouteInspectionMetadata,
): void {
  let routeMap = legacyRouteInspectionMetadataStore.get(target);

  if (!routeMap) {
    routeMap = new Map<MetadataPropertyKey, RuntimeRouteInspectionMetadata>();
    legacyRouteInspectionMetadataStore.set(target, routeMap);
  }

  routeMap.set(propertyKey, cloneMetadata(value));
}

function isRuntimeRouteInspectionMetadata(value: unknown): value is RuntimeRouteInspectionMetadata {
  const kind = typeof value === 'object' && value !== null ? Reflect.get(value, 'kind') : undefined;

  return typeof value === 'object'
    && value !== null
    && typeof kind === 'string'
    && kind.length > 0;
}

/**
 * Reads the immutable route inspection marker for a compiled controller method.
 *
 * @param controllerToken Controller class that owns the route handler.
 * @param propertyKey Controller method key associated with the route.
 * @returns The normalized route metadata when a package integration recorded one.
 */
export function getRuntimeRouteInspectionMetadata(
  controllerToken: Function,
  propertyKey: MetadataPropertyKey,
): RuntimeRouteInspectionMetadata | undefined {
  const legacyMetadata = legacyRouteInspectionMetadataStore.get(controllerToken.prototype)?.get(propertyKey);
  const standardRouteMap = getStandardMetadataBag(controllerToken)?.[runtimeRouteInspectionMetadataKey];
  const standardMetadata = standardRouteMap instanceof Map ? standardRouteMap.get(propertyKey) : undefined;
  const metadata = legacyMetadata ?? standardMetadata;

  return isRuntimeRouteInspectionMetadata(metadata) ? cloneMetadata(metadata) : undefined;
}
