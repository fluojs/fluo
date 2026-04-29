import { type Constructor, type MetadataPropertyKey } from '@fluojs/core';
import { getControllerMetadata, getRouteMetadata } from '@fluojs/core/internal';

import { getRouteProducesMetadata } from './decorators.js';
import { RouteConflictError } from './errors.js';
import { extractRoutePathParams, normalizeRoutePath, parseRoutePath, type RoutePathSegment } from './route-path.js';
import { VersioningType } from './types.js';
import type {
  FrameworkRequest,
  GuardLike,
  HandlerDescriptor,
  HandlerMapping,
  HandlerMatch,
  HandlerSource,
  InterceptorLike,
  HttpMethod,
  VersioningExtractor,
  VersioningOptions,
} from './types.js';

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

function readHeaderValue(request: FrameworkRequest, headerName: string): string | undefined {
  const normalizedHeaderName = headerName.trim().toLowerCase();

  if (!normalizedHeaderName) {
    return undefined;
  }

  for (const [key, raw] of Object.entries(request.headers)) {
    if (key.toLowerCase() !== normalizedHeaderName) {
      continue;
    }

    const values = Array.isArray(raw) ? raw : [raw];

    for (const value of values) {
      const normalized = value?.trim();

      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractVersionFromMediaType(request: FrameworkRequest, key: string): string | undefined {
  const accept = readHeaderValue(request, 'accept');

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

function buildDescriptorIndex(descriptors: HandlerDescriptor[]): CompiledDescriptorIndex {
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

function createHandlerDescriptors(source: HandlerSource, versioning: ResolvedVersioning): HandlerDescriptor[] {
  const controllerMetadata = getControllerMetadata(source.controllerToken) ?? { basePath: '' };
  const descriptors: HandlerDescriptor[] = [];

  for (const propertyKey of getControllerMethodNames(source.controllerToken)) {
    const routeMetadata = getRouteMetadata(source.controllerToken.prototype, propertyKey);

    if (!routeMetadata) {
      continue;
    }

    const effectiveVersion = routeMetadata.version ?? controllerMetadata.version;
    const routePath = joinPaths(controllerMetadata.basePath, routeMetadata.path);
    const effectivePath = versioning.type === VersioningType.URI ? applyVersionPrefix(routePath, effectiveVersion) : routePath;
    const produces = getRouteProducesMetadata(source.controllerToken, propertyKey);

    descriptors.push({
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
    });
  }

  return descriptors;
}

function buildDescriptorList(sources: HandlerSource[], versioning: ResolvedVersioning): HandlerDescriptor[] {
  const descriptors = sources.flatMap((source) => createHandlerDescriptors(source, versioning));
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

/**
 * Create handler mapping.
 *
 * @param sources The sources.
 * @param options The options.
 * @returns The create handler mapping result.
 */
export function createHandlerMapping(sources: HandlerSource[], options?: CreateHandlerMappingOptions): HandlerMapping {
  const versioning = resolveVersioning(options);
  const descriptors = buildDescriptorList(sources, versioning);
  const descriptorIndex = buildDescriptorIndex(descriptors);

  return {
    descriptors,
    match(request: FrameworkRequest): HandlerMatch | undefined {
      const method = request.method.toUpperCase() as HttpMethod;
      const requestVersion = versioning.type === VersioningType.URI ? undefined : resolveRequestVersion(request, versioning);
      const normalizedPath = normalizeRoutePath(request.path);
      const methodStaticDescriptors = descriptorIndex.static.get(method)?.get(normalizedPath);
      const allStaticDescriptors = descriptorIndex.static.get('ALL' as HttpMethod)?.get(normalizedPath);
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
        ...(descriptorIndex.param.get('ALL' as HttpMethod)?.get(incomingSegments.length) ?? []),
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
}
