import type { HandlerDescriptor, HttpMethod, VersioningType } from '@fluojs/http/portable';
import { createRuntimeRouteInspection } from '@fluojs/runtime/internal';

import { getReactPathMetadata, getReactRouterMetadata } from './decorators.js';
import type { ReactQueryField } from './typegen-projection.js';

/**
 * Immutable bootstrap-resolved description of one React page handler.
 *
 * @remarks
 * The catalog is a one-way projection from authoritative compiled HTTP descriptors.
 * Effective path, method, version, and params come from HTTP compilation rather than
 * the static values passed to `@Router(...)` and `@Path(...)`. Catalog entries never
 * participate in route matching, conflict detection, or dispatch.
 */
export interface ReactPageCatalogEntry {
  readonly handler: string;
  readonly id: string;
  readonly kind: 'react-page';
  readonly method: HttpMethod;
  readonly module?: string;
  readonly params: readonly string[];
  readonly path: string;
  readonly router: string;
  readonly version?: string;
  /** HTTP compiler provenance; absence cannot establish URI-based version selection. */
  readonly versionSelection?: VersioningType;
  /** Compiler-projected query input derived from the actual HTTP request DTO. */
  readonly query?: readonly ReactQueryField[];
  /** Frozen source/configuration digest, including type-only dependencies. */
  readonly sourceFingerprint?: string;
}

/**
 * Creates an immutable React page catalog from compiled HTTP handler descriptors.
 *
 * @param descriptors Authoritative descriptors produced by `createHandlerMapping(...)`.
 * @returns Frozen React page entries in descriptor registration order; ordinary HTTP handlers are omitted.
 */
export function createReactPageCatalog(
  descriptors: readonly HandlerDescriptor[],
): readonly ReactPageCatalogEntry[] {
  const pages: ReactPageCatalogEntry[] = [];

  for (const descriptor of descriptors) {
    const routerMetadata = getReactRouterMetadata(descriptor.controllerToken);
    const pathMetadata = getReactPathMetadata(descriptor.controllerToken, descriptor.methodName);

    if (!routerMetadata || !pathMetadata) {
      continue;
    }

    const route = createRuntimeRouteInspection(descriptor);
    pages.push(Object.freeze({
      handler: route.handler,
      id: route.id,
      kind: 'react-page',
      method: route.method,
      ...(route.module ? { module: route.module } : {}),
      params: route.params,
      path: route.path,
      router: route.controller,
      ...(route.version ? { version: route.version } : {}),
      ...(descriptor.metadata.versionSelection === undefined
        ? {} : { versionSelection: descriptor.metadata.versionSelection }),
    }));
  }

  return Object.freeze(pages);
}
