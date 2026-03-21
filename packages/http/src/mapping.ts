import { getControllerMetadata, getRouteMetadata, type Constructor, type MetadataPropertyKey } from '@konekti/core';

import { getRouteProducesMetadata } from './decorators.js';
import { RouteConflictError } from './errors.js';
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

function normalizePath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const normalized = `/${segments.join('/')}`;

  return normalized === '' ? '/' : normalized;
}

function joinPaths(basePath: string, routePath: string): string {
  return normalizePath(`${basePath}/${routePath}`);
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

function extractPathParams(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

function matchPath(registeredPath: string, incomingPath: string): Readonly<Record<string, string>> | undefined {
  const registeredSegments = normalizePath(registeredPath).split('/').filter(Boolean);
  const incomingSegments = normalizePath(incomingPath).split('/').filter(Boolean);

  if (registeredSegments.length !== incomingSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};

  for (const [index, segment] of registeredSegments.entries()) {
    const incoming = incomingSegments[index];

    if (segment.startsWith(':')) {
      params[segment.slice(1)] = incoming;
      continue;
    }

    if (segment !== incoming) {
      return undefined;
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
        pathParams: extractPathParams(effectivePath),
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
    const routeKey = `${descriptor.route.method}:${descriptor.route.path}:${descriptor.route.version ?? '<none>'}`;

    if (seen.has(routeKey)) {
      throw new RouteConflictError(`Duplicate route registration detected for ${routeKey}.`);
    }

    seen.add(routeKey);
  }

  return descriptors;
}

export function createHandlerMapping(sources: HandlerSource[], options?: CreateHandlerMappingOptions): HandlerMapping {
  const versioning = resolveVersioning(options);
  const descriptors = buildDescriptorList(sources, versioning);

  return {
    descriptors,
    match(request: FrameworkRequest): HandlerMatch | undefined {
      const method = request.method.toUpperCase() as HttpMethod;
      const requestVersion = versioning.type === VersioningType.URI ? undefined : resolveRequestVersion(request, versioning);
      const matchedDescriptors: Array<{ descriptor: HandlerDescriptor; params: Readonly<Record<string, string>> }> = [];

      for (const descriptor of descriptors) {
        if (descriptor.route.method !== method) {
          continue;
        }

        const params = matchPath(descriptor.route.path, request.path);

        if (!params) {
          continue;
        }

        matchedDescriptors.push({ descriptor, params });

        if (versioning.type === VersioningType.URI) {
          return {
            descriptor,
            params,
          };
        }
      }

      if (versioning.type !== VersioningType.URI) {
        for (const match of matchedDescriptors) {
          if (!matchesRouteVersion(match.descriptor, requestVersion)) {
            continue;
          }

          return {
            descriptor: match.descriptor,
            params: match.params,
          };
        }

        for (const match of matchedDescriptors) {
          if (match.descriptor.route.version !== undefined) {
            continue;
          }

          return {
            descriptor: match.descriptor,
            params: match.params,
          };
        }
      }

      return undefined;
    },
  };
}
