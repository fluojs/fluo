import type { HandlerDescriptor, HttpMethod } from '@fluojs/http';

import { getRuntimeRouteInspectionMetadata } from './internal/route-inspection-metadata.js';
import type { PlatformShellSnapshot } from './platform-contract.js';

/**
 * Read-only, serializable description of one compiled HTTP handler.
 *
 * @remarks
 * Values are projected from authoritative `HandlerDescriptor` fields after HTTP route
 * compilation. `kind` is `http` unless a framework integration records a more specific
 * runtime-neutral inspection marker. This contract never participates in matching,
 * conflict detection, or dispatch.
 */
export interface RuntimeRouteInspection {
  readonly controller: string;
  readonly handler: string;
  readonly id: string;
  readonly kind: string;
  readonly method: HttpMethod;
  readonly module?: string;
  readonly params: readonly string[];
  readonly path: string;
  readonly version?: string;
}

/** Runtime platform snapshot extended with compiled route inspection data. */
export interface RuntimeInspectionSnapshot extends PlatformShellSnapshot {
  readonly routes: readonly RuntimeRouteInspection[];
}

function effectivePath(descriptor: HandlerDescriptor): string {
  return descriptor.metadata.effectivePath || descriptor.route.path;
}

/**
 * Creates the stable identifier shared by route inspection consumers.
 *
 * @param descriptor Compiled HTTP handler descriptor to identify.
 * @returns Stable identifier containing method, effective path, controller, and handler.
 */
export function createRuntimeRouteInspectionId(descriptor: HandlerDescriptor): string {
  return [
    descriptor.route.method,
    effectivePath(descriptor),
    descriptor.controllerToken.name || '<anonymous-controller>',
    descriptor.methodName,
  ].join(' ');
}

/**
 * Projects one compiled HTTP descriptor into immutable machine-readable route data.
 *
 * @param descriptor Authoritative descriptor produced by the HTTP handler mapping.
 * @returns Frozen route inspection entry detached from mutable descriptor collections.
 */
export function createRuntimeRouteInspection(descriptor: HandlerDescriptor): RuntimeRouteInspection {
  const route: RuntimeRouteInspection = {
    controller: descriptor.controllerToken.name || '<anonymous-controller>',
    handler: descriptor.methodName,
    id: createRuntimeRouteInspectionId(descriptor),
    kind: getRuntimeRouteInspectionMetadata(descriptor.controllerToken, descriptor.methodName)?.kind ?? 'http',
    method: descriptor.route.method,
    params: Object.freeze([...descriptor.metadata.pathParams]),
    path: effectivePath(descriptor),
  };
  const moduleName = descriptor.metadata.moduleType?.name;
  const version = descriptor.metadata.effectiveVersion ?? descriptor.route.version;

  return Object.freeze({
    ...route,
    ...(moduleName ? { module: moduleName } : {}),
    ...(version ? { version } : {}),
  });
}

/**
 * Projects compiled HTTP descriptors into an immutable route catalog for diagnostics.
 *
 * @param descriptors Authoritative descriptors produced by the HTTP handler mapping.
 * @returns Frozen route entries in descriptor registration order.
 */
export function createRuntimeRouteCatalog(
  descriptors: readonly HandlerDescriptor[],
): readonly RuntimeRouteInspection[] {
  return Object.freeze(descriptors.map((descriptor) => createRuntimeRouteInspection(descriptor)));
}

/**
 * Adds immutable route inspection data to a runtime platform snapshot.
 *
 * @param snapshot Existing runtime-owned platform snapshot.
 * @param descriptors Authoritative compiled HTTP descriptors.
 * @returns A new frozen snapshot with a read-only `routes` collection.
 */
export function createRuntimeInspectionSnapshot(
  snapshot: PlatformShellSnapshot,
  descriptors: readonly HandlerDescriptor[],
): RuntimeInspectionSnapshot {
  return Object.freeze({
    ...snapshot,
    routes: createRuntimeRouteCatalog(descriptors),
  });
}
