import type { Constructor, MetadataPropertyKey } from '@fluojs/core';
import { getControllerMetadata, getRouteMetadata } from '@fluojs/core/internal';

import { attachCompiledRouteIdentity } from './compiled-route-identity.js';
import { getRouteProducesMetadata } from './decorators.js';
import { RouteConflictError } from './errors.js';
import { isMiddlewareRouteConfig } from './middleware/middleware.js';
import { extractRoutePathParams, normalizeRoutePath, parseRoutePath, type RoutePathSegment } from './route-path.js';
import type {
  FrameworkRequest,
  GuardLike,
  HandlerDescriptor,
  HandlerMapping,
  HandlerMatch,
  HandlerMetadata,
  HandlerRouteSnapshot,
  HandlerSource,
  HttpMethod,
  InterceptorLike,
  MiddlewareLike,
  MiddlewareSnapshotLike,
  RouteDefinition,
  VersioningExtractor,
  VersioningOptions,
} from './types.js';
import { VersioningType } from './types.js';

interface ResolvedVersioning {
  extractor: VersioningExtractor;
  type: VersioningType;
}

interface CreateHandlerMappingOptions {
  versioning?: VersioningOptions;
}

type IndexedDescriptor = {
  descriptor: HandlerDescriptor;
  segments: readonly RoutePathSegment[];
};

type StaticDescriptorIndex = Map<HttpMethod, Map<string, HandlerDescriptor[]>>;
type ParamDescriptorIndex = Map<HttpMethod, Map<number, IndexedDescriptor[]>>;

interface CompiledDescriptorIndex {
  param: ParamDescriptorIndex;
  static: StaticDescriptorIndex;
}

interface MutableHandlerMetadata {
  controllerPath: string;
  effectivePath: string;
  effectiveVersion?: string;
  moduleMiddleware: MiddlewareSnapshotLike[];
  moduleType?: Constructor;
  pathParams: string[];
}

interface MutableHandlerDescriptor {
  controllerToken: Constructor;
  metadata: MutableHandlerMetadata;
  methodName: string;
  route: RouteDefinition;
}

function joinPaths(basePath: string, routePath: string): string {
  return normalizeRoutePath(`${basePath}/${routePath}`);
}

function normalizeVersionSegment(version: string): string {
  const normalized = version.trim().replace(/^v/i, '');

  return `v${normalized}`;
}

function applyVersionPrefix(path: string, version: string | undefined): string {
  if (!version) {
    return path;
  }

  return joinPaths(`/${normalizeVersionSegment(version)}`, path);
}

function normalizeVersionValue(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function normalizeHeaderName(headerName: string): string | undefined {
  const normalized = headerName.trim().toLowerCase();

  return normalized.length > 0 ? normalized : undefined;
}

function getMatchingRequestHeaderValues(
  request: FrameworkRequest,
  headerName: string,
): readonly (string | string[] | undefined)[] {
  const normalizedHeaderName = normalizeHeaderName(headerName);

  if (!normalizedHeaderName) {
    return [];
  }

  const matches: Array<string | string[] | undefined> = [];

  for (const [name, value] of Object.entries(request.headers)) {
    if (name.toLowerCase() === normalizedHeaderName) {
      matches.push(value);
    }
  }

  return matches;
}

function readHeaderValue(request: FrameworkRequest, headerName: string): string | undefined {
  const matches = getMatchingRequestHeaderValues(request, headerName);

  for (const match of matches) {
    const values = Array.isArray(match) ? match : [match];

    for (const value of values) {
      const normalized = value?.trim();

      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function readCombinedHeaderValue(
  request: FrameworkRequest,
  headerName: string,
): string | undefined {
  const matches = getMatchingRequestHeaderValues(request, headerName);
  const values: string[] = [];

  for (const match of matches) {
    const entries = Array.isArray(match) ? match : [match];

    for (const entry of entries) {
      const normalized = entry?.trim();

      if (normalized) {
        values.push(normalized);
      }
    }
  }

  return values.length > 0 ? values.join(',') : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractVersionFromMediaType(request: FrameworkRequest, key: string): string | undefined {
  const accept = readCombinedHeaderValue(request, 'accept');

  if (!accept) {
    return undefined;
  }

  const escapedKey = escapeRegExp(key);
  const matcher = new RegExp(`${escapedKey}([^;,+\\s]+)`, 'i');
  const mediaTypes = accept.split(',').map((value) => value.trim()).filter(Boolean);

  for (const mediaType of mediaTypes) {
    const match = mediaType.match(matcher);
    const extracted = match?.[1]?.trim();

    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

function resolveVersioning(options: CreateHandlerMappingOptions | undefined): ResolvedVersioning {
  const versioning = options?.versioning;

  if (!versioning || versioning.type === undefined || versioning.type === VersioningType.URI) {
    return {
      extractor: () => undefined,
      type: VersioningType.URI,
    };
  }

  if (versioning.type === VersioningType.HEADER) {
    return {
      extractor: (request) => readHeaderValue(request, versioning.header),
      type: VersioningType.HEADER,
    };
  }

  if (versioning.type === VersioningType.MEDIA_TYPE) {
    return {
      extractor: (request) => extractVersionFromMediaType(request, versioning.key ?? 'v='),
      type: VersioningType.MEDIA_TYPE,
    };
  }

  if (versioning.type === VersioningType.CUSTOM) {
    return {
      extractor: versioning.extractor,
      type: VersioningType.CUSTOM,
    };
  }

  return {
    extractor: () => undefined,
    type: VersioningType.URI,
  };
}

function resolveRequestVersion(request: FrameworkRequest, versioning: ResolvedVersioning): string | undefined {
  const raw = versioning.extractor(request);
  const values = Array.isArray(raw) ? raw : [raw];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = normalizeVersionValue(value);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function matchesRouteVersion(
  descriptor: HandlerDescriptor,
  requestVersion: string | undefined,
): boolean {
  const routeVersion = descriptor.route.version;

  if (!routeVersion) {
    return requestVersion === undefined;
  }

  if (!requestVersion) {
    return false;
  }

  return normalizeVersionValue(routeVersion) === requestVersion;
}

function getControllerMethodNames(controllerToken: Constructor): MetadataPropertyKey[] {
  return Object.getOwnPropertyNames(controllerToken.prototype).filter((propertyKey) => propertyKey !== 'constructor');
}

function buildDescriptorIndex(descriptors: readonly HandlerDescriptor[]): CompiledDescriptorIndex {
  const staticIndex: StaticDescriptorIndex = new Map();
  const paramIndex: ParamDescriptorIndex = new Map();

  for (const descriptor of descriptors) {
    const method = descriptor.route.method;
    const segments = parseRoutePath(descriptor.route.path, `Registered ${descriptor.route.method} route path`);

    if (segments.every((segment) => segment.kind === 'literal')) {
      let methodMap = staticIndex.get(method);
      if (!methodMap) {
        methodMap = new Map();
        staticIndex.set(method, methodMap);
      }

      const path = descriptor.route.path;
      const bucket = methodMap.get(path);

      if (bucket) {
        bucket.push(descriptor);
      } else {
        methodMap.set(path, [descriptor]);
      }

      continue;
    }

    const segmentCount = segments.length;
    let methodMap = paramIndex.get(method);
    if (!methodMap) {
      methodMap = new Map();
      paramIndex.set(method, methodMap);
    }

    let bucket = methodMap.get(segmentCount);
    if (!bucket) {
      bucket = [];
      methodMap.set(segmentCount, bucket);
    }

    bucket.push({ descriptor, segments });
  }

  return {
    param: paramIndex,
    static: staticIndex,
  };
}

function findStaticMatch(
  descriptorBuckets: readonly (readonly HandlerDescriptor[] | undefined)[],
  requestVersion: string | undefined,
  versioning: ResolvedVersioning,
): HandlerMatch | undefined {
  let firstUnversionedMatch: HandlerMatch | undefined;

  for (const descriptors of descriptorBuckets) {
    if (!descriptors || descriptors.length === 0) {
      continue;
    }

    for (const descriptor of descriptors) {
      if (versioning.type === VersioningType.URI) {
        return {
          descriptor,
          params: {},
        };
      }

      if (matchesRouteVersion(descriptor, requestVersion)) {
        return {
          descriptor,
          params: {},
        };
      }

      if (descriptor.route.version === undefined && !firstUnversionedMatch) {
        firstUnversionedMatch = {
          descriptor,
          params: {},
        };
      }
    }
  }

  return firstUnversionedMatch;
}

function matchParameterizedRoute(
  candidate: IndexedDescriptor,
  incomingSegments: readonly string[],
): Readonly<Record<string, string>> | undefined {
  const { segments } = candidate;

  if (segments.length !== incomingSegments.length) {
    return undefined;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === 'literal' && segment.value !== incomingSegments[index]) {
      return undefined;
    }
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === 'param') {
      params[segment.name] = incomingSegments[index];
    }
  }

  return params;
}

function createHandlerDescriptors(
  source: HandlerSource,
  versioning: ResolvedVersioning,
  sourceIndex: number,
): MutableHandlerDescriptor[] {
  const controllerMetadata = getControllerMetadata(source.controllerToken) ?? { basePath: '' };
  const descriptors: MutableHandlerDescriptor[] = [];

  for (const [methodIndex, propertyKey] of getControllerMethodNames(source.controllerToken).entries()) {
    const routeMetadata = getRouteMetadata(source.controllerToken.prototype, propertyKey);

    if (!routeMetadata) {
      continue;
    }

    const effectiveVersion = routeMetadata.version ?? controllerMetadata.version;
    const routePath = joinPaths(controllerMetadata.basePath, routeMetadata.path);
    const effectivePath = versioning.type === VersioningType.URI ? applyVersionPrefix(routePath, effectiveVersion) : routePath;
    const produces = getRouteProducesMetadata(source.controllerToken, propertyKey);

    descriptors.push(attachCompiledRouteIdentity({
      controllerToken: source.controllerToken,
        metadata: {
          controllerPath: controllerMetadata.basePath,
          effectivePath,
          effectiveVersion,
          moduleMiddleware: [...(source.moduleMiddleware ?? [])],
          moduleType: source.moduleType,
          pathParams: extractRoutePathParams(effectivePath),
        },
      methodName: String(propertyKey),
      route: {
        ...routeMetadata,
        ...(produces ? { produces } : {}),
        guards: [
          ...((controllerMetadata.guards ?? []) as GuardLike[]),
          ...((routeMetadata.guards ?? []) as GuardLike[]),
        ],
        interceptors: [
          ...((controllerMetadata.interceptors ?? []) as InterceptorLike[]),
          ...((routeMetadata.interceptors ?? []) as InterceptorLike[]),
        ],
        path: effectivePath,
        version: effectiveVersion,
      },
    }, `v1:${sourceIndex}:${methodIndex}`));
  }

  return descriptors;
}

function buildDescriptorList(sources: HandlerSource[], versioning: ResolvedVersioning): MutableHandlerDescriptor[] {
  const descriptors = sources.flatMap((source, sourceIndex) =>
    createHandlerDescriptors(source, versioning, sourceIndex));
  const seen = new Set<string>();

  for (const descriptor of descriptors) {
    const routeVersion = descriptor.route.version === undefined ? '<none>' : normalizeVersionValue(descriptor.route.version);
    const routeKey = `${descriptor.route.method}:${descriptor.route.path}:${routeVersion}`;

    if (seen.has(routeKey)) {
      throw new RouteConflictError(`Duplicate route registration detected for ${routeKey}.`);
    }

    seen.add(routeKey);
  }

  return descriptors;
}

function freezeDescriptorSnapshot(descriptors: readonly MutableHandlerDescriptor[]): readonly HandlerDescriptor[] {
  const snapshot = descriptors.map((descriptor): HandlerDescriptor => {
    const { metadata, route } = descriptor;
    const frozenMetadata: HandlerMetadata = Object.freeze({
      ...metadata,
      moduleMiddleware: freezeModuleMiddlewareSnapshot(metadata.moduleMiddleware),
      pathParams: Object.freeze([...metadata.pathParams]),
    });
    const frozenRoute: HandlerRouteSnapshot = Object.freeze({
      ...route,
      ...(route.guards ? { guards: Object.freeze([...route.guards]) } : {}),
      ...(route.headers
        ? { headers: Object.freeze(route.headers.map((header) => Object.freeze({ ...header }))) }
        : {}),
      ...(route.interceptors ? { interceptors: Object.freeze([...route.interceptors]) } : {}),
      ...(route.produces ? { produces: Object.freeze([...route.produces]) } : {}),
      ...(route.redirect ? { redirect: Object.freeze({ ...route.redirect }) } : {}),
    });

    return Object.freeze({
      ...descriptor,
      metadata: frozenMetadata,
      route: frozenRoute,
    });
  });

  return Object.freeze(snapshot);
}

function freezeModuleMiddlewareSnapshot(
  definitions: readonly (MiddlewareLike | MiddlewareSnapshotLike)[],
): readonly MiddlewareSnapshotLike[] {
  const snapshot = definitions.map((definition) => {
    if (!isMiddlewareRouteConfig(definition)) {
      return definition;
    }

    return Object.freeze({
      middleware: definition.middleware,
      routes: Object.freeze([...definition.routes]),
    });
  });

  return Object.freeze(snapshot);
}

/**
 * Create handler mapping.
 *
 * @param sources The sources.
 * @param options The options.
 * @returns The create handler mapping result.
 */
export function createHandlerMapping(sources: HandlerSource[], options?: CreateHandlerMappingOptions): HandlerMapping {
  const versioning = resolveVersioning(options);
  const descriptors = freezeDescriptorSnapshot(buildDescriptorList(sources, versioning));
  const descriptorIndex = buildDescriptorIndex(descriptors);

  const mapping = {
    descriptors,
    match(request: FrameworkRequest): HandlerMatch | undefined {
      const method = request.method.toUpperCase();
      const requestVersion = versioning.type === VersioningType.URI ? undefined : resolveRequestVersion(request, versioning);
      const normalizedPath = normalizeRoutePath(request.path);
      const methodStaticDescriptors = descriptorIndex.static.get(method)?.get(normalizedPath);
      const allStaticDescriptors = descriptorIndex.static.get('ALL')?.get(normalizedPath);
      const directStaticMatch = findStaticMatch(
        [methodStaticDescriptors, allStaticDescriptors],
        requestVersion,
        versioning,
      );

      if (directStaticMatch) {
        return directStaticMatch;
      }

      const incomingSegments = normalizedPath.split('/').filter(Boolean);
      const candidates = [
        ...(descriptorIndex.param.get(method)?.get(incomingSegments.length) ?? []),
        ...(descriptorIndex.param.get('ALL')?.get(incomingSegments.length) ?? []),
      ];
      let firstUnversionedMatch: HandlerMatch | undefined;

      for (const candidate of candidates) {
        const params = matchParameterizedRoute(candidate, incomingSegments);

        if (!params) {
          continue;
        }

        if (versioning.type === VersioningType.URI) {
          return {
            descriptor: candidate.descriptor,
            params,
          };
        }

        if (matchesRouteVersion(candidate.descriptor, requestVersion)) {
          return {
            descriptor: candidate.descriptor,
            params,
          };
        }

        if (candidate.descriptor.route.version === undefined && !firstUnversionedMatch) {
          firstUnversionedMatch = {
            descriptor: candidate.descriptor,
            params,
          };
        }
      }

      if (versioning.type !== VersioningType.URI) {
        if (firstUnversionedMatch) {
          return {
            descriptor: firstUnversionedMatch.descriptor,
            params: firstUnversionedMatch.params,
          };
        }
      }

      return undefined;
    },
  };

  Object.defineProperty(mapping, 'descriptors', {
    configurable: false,
    writable: false,
  });

  return mapping;
}
