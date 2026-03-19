import { getControllerMetadata, getRouteMetadata, type Constructor, type MetadataPropertyKey } from '@konekti/core';

import { getRouteProducesMetadata } from './decorators.js';
import { RouteConflictError } from './errors.js';
import type {
  FrameworkRequest,
  GuardLike,
  HandlerDescriptor,
  HandlerMapping,
  HandlerMatch,
  HandlerSource,
  InterceptorLike,
  HttpMethod,
} from './types.js';

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

function createHandlerDescriptors(source: HandlerSource): HandlerDescriptor[] {
  const controllerMetadata = getControllerMetadata(source.controllerToken) ?? { basePath: '' };
  const descriptors: HandlerDescriptor[] = [];

  for (const propertyKey of getControllerMethodNames(source.controllerToken)) {
    const routeMetadata = getRouteMetadata(source.controllerToken.prototype, propertyKey);

    if (!routeMetadata) {
      continue;
    }

    const effectiveVersion = routeMetadata.version ?? controllerMetadata.version;
    const effectivePath = applyVersionPrefix(joinPaths(controllerMetadata.basePath, routeMetadata.path), effectiveVersion);
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

function buildDescriptorList(sources: HandlerSource[]): HandlerDescriptor[] {
  const descriptors = sources.flatMap((source) => createHandlerDescriptors(source));
  const seen = new Set<string>();

  for (const descriptor of descriptors) {
    const routeKey = `${descriptor.route.method}:${descriptor.route.path}`;

    if (seen.has(routeKey)) {
      throw new RouteConflictError(`Duplicate route registration detected for ${routeKey}.`);
    }

    seen.add(routeKey);
  }

  return descriptors;
}

export function createHandlerMapping(sources: HandlerSource[]): HandlerMapping {
  const descriptors = buildDescriptorList(sources);

  return {
    descriptors,
    match(request: FrameworkRequest): HandlerMatch | undefined {
      const method = request.method.toUpperCase() as HttpMethod;

      for (const descriptor of descriptors) {
        if (descriptor.route.method !== method) {
          continue;
        }

        const params = matchPath(descriptor.route.path, request.path);

        if (!params) {
          continue;
        }

        return {
          descriptor,
          params,
        };
      }

      return undefined;
    },
  };
}
