import type { HandlerDescriptor } from '@fluojs/http';
import { isRoutePathNormalizationSensitive } from '@fluojs/http/internal';

const FASTIFY_NATIVE_ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
const FASTIFY_NATIVE_ROUTE_METHOD_SET: ReadonlySet<string> = new Set(FASTIFY_NATIVE_ROUTE_METHODS);
const EMPTY_NATIVE_ROUTE_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

export type FastifyNativeRouteMethod = (typeof FASTIFY_NATIVE_ROUTE_METHODS)[number];

export interface FastifyNativeRouteDefinition {
  readonly descriptor: HandlerDescriptor;
  readonly hasPathParams: boolean;
  readonly method: FastifyNativeRouteMethod;
  readonly path: string;
}

interface FastifyNativeRouteCandidate extends FastifyNativeRouteDefinition {
  readonly shapeKey: string;
}

export interface FastifyNativeRouteUrlParts {
  readonly path: string;
  readonly search: string;
}

export interface FastifyNativeRouteRequestResolution {
  readonly canUseNativeRoute: boolean;
  readonly params: Readonly<Record<string, string>>;
  readonly urlParts: FastifyNativeRouteUrlParts;
}

export function createFastifyNativeRoutes(descriptors: readonly HandlerDescriptor[]): FastifyNativeRouteDefinition[] {
  const candidates = new Map<string, FastifyNativeRouteCandidate>();
  const shapePaths = new Map<string, Set<string>>();
  const versionSensitiveRouteKeys = collectVersionSensitiveRouteKeys(descriptors);

  for (const descriptor of descriptors) {
    if (!isFastifyNativeRouteDescriptor(descriptor)
      || versionSensitiveRouteKeys.has(`${descriptor.route.method}:${descriptor.route.path}`)) {
      continue;
    }

    registerFastifyNativeRouteCandidate(candidates, shapePaths, descriptor);
  }

  return [...candidates.values()]
    .filter((candidate) => shapePaths.get(candidate.shapeKey)?.size === 1)
    .map(({ descriptor, hasPathParams, method, path }) => ({
      descriptor,
      hasPathParams,
      method,
      path,
    }));
}

export function resolveFastifyNativeRouteRequest(
  route: FastifyNativeRouteDefinition,
  rawUrl: string,
  rawParams: unknown,
): FastifyNativeRouteRequestResolution {
  const params = route.hasPathParams
    ? normalizeNativeRouteParams(rawParams)
    : EMPTY_NATIVE_ROUTE_PARAMS;
  const urlParts = resolveFastifyNativeRouteUrlParts(route, rawUrl);
  const canUseNativeRoute = !isRoutePathNormalizationSensitive(urlParts.path)
    && (!route.hasPathParams || !hasNativeRouteParamSeparators(params));

  return {
    canUseNativeRoute,
    params,
    urlParts,
  };
}

function isFastifyNativeRouteDescriptor(descriptor: HandlerDescriptor): descriptor is HandlerDescriptor & {
  route: HandlerDescriptor['route'] & { method: FastifyNativeRouteMethod };
} {
  return isFastifyNativeRouteMethod(descriptor.route.method) && descriptor.route.version === undefined;
}

function isFastifyNativeRouteMethod(method: string): method is FastifyNativeRouteMethod {
  return FASTIFY_NATIVE_ROUTE_METHOD_SET.has(method);
}

function registerFastifyNativeRouteCandidate(
  candidates: Map<string, FastifyNativeRouteCandidate>,
  shapePaths: Map<string, Set<string>>,
  descriptor: HandlerDescriptor & {
    route: HandlerDescriptor['route'] & { method: FastifyNativeRouteMethod };
  },
): void {
  const method = descriptor.route.method;
  const path = descriptor.route.path;
  const routeKey = `${method}:${path}`;
  const shapeKey = `${method}:${canonicalizeFastifyRouteShape(path)}`;

  if (!candidates.has(routeKey)) {
    candidates.set(routeKey, {
      descriptor,
      hasPathParams: descriptor.metadata.pathParams.length > 0,
      method,
      path,
      shapeKey,
    });
  }

  let paths = shapePaths.get(shapeKey);

  if (!paths) {
    paths = new Set<string>();
    shapePaths.set(shapeKey, paths);
  }

  paths.add(path);
}

function canonicalizeFastifyRouteShape(path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.startsWith(':') ? ':' : segment);

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function resolveFastifyNativeRouteUrlParts(
  route: FastifyNativeRouteDefinition,
  rawUrl: string,
): FastifyNativeRouteUrlParts {
  if (route.hasPathParams || shouldSplitNativeRouteUrl(rawUrl)) {
    return splitFastifyNativeRouteUrl(rawUrl);
  }

  return {
    path: route.path,
    search: readFastifyNativeRouteSearch(rawUrl),
  };
}

function shouldSplitNativeRouteUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.includes('#')) {
    return true;
  }

  return isRawPathNormalizationSensitive(rawUrl);
}

function isRawPathNormalizationSensitive(rawUrl: string): boolean {
  const queryStart = rawUrl.indexOf('?');
  const pathEnd = queryStart === -1 ? rawUrl.length : queryStart;

  if (pathEnd > 1 && rawUrl.charCodeAt(pathEnd - 1) === 47) {
    return true;
  }

  for (let index = 1; index < pathEnd; index++) {
    if (rawUrl.charCodeAt(index - 1) === 47 && rawUrl.charCodeAt(index) === 47) {
      return true;
    }
  }

  return false;
}

function readFastifyNativeRouteSearch(rawUrl: string): string {
  const queryStart = rawUrl.indexOf('?');
  return queryStart === -1 ? '' : rawUrl.slice(queryStart);
}

function splitFastifyNativeRouteUrl(rawUrl: string): FastifyNativeRouteUrlParts {
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    const url = new URL(rawUrl);
    return {
      path: url.pathname,
      search: url.search,
    };
  }

  const queryStart = rawUrl.indexOf('?');
  const hashStart = rawUrl.indexOf('#');
  const pathEnd = resolveFastifyNativeRoutePathEnd(rawUrl.length, queryStart, hashStart);
  const path = rawUrl.slice(0, pathEnd) || '/';

  if (queryStart === -1) {
    return { path, search: '' };
  }

  const searchEnd = hashStart >= 0 && hashStart > queryStart ? hashStart : rawUrl.length;

  return {
    path,
    search: rawUrl.slice(queryStart, searchEnd),
  };
}

function resolveFastifyNativeRoutePathEnd(rawUrlLength: number, queryStart: number, hashStart: number): number {
  if (queryStart === -1) {
    return hashStart === -1 ? rawUrlLength : hashStart;
  }

  if (hashStart === -1) {
    return queryStart;
  }

  return Math.min(queryStart, hashStart);
}

function normalizeNativeRouteParams(params: unknown): Readonly<Record<string, string>> {
  if (typeof params !== 'object' || params === null) {
    return EMPTY_NATIVE_ROUTE_PARAMS;
  }

  let normalized: Record<string, string> | undefined;

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    normalized ??= {};
    normalized[key] = typeof value === 'string' ? value : String(value);
  }

  return normalized ?? EMPTY_NATIVE_ROUTE_PARAMS;
}

function hasNativeRouteParamSeparators(params: Readonly<Record<string, string>>): boolean {
  for (const key in params) {
    if (Object.hasOwn(params, key) && params[key]?.includes('/')) {
      return true;
    }
  }

  return false;
}

function collectVersionSensitiveRouteKeys(descriptors: readonly HandlerDescriptor[]): Set<string> {
  const grouped = new Map<string, { count: number; hasVersioned: boolean }>();

  for (const descriptor of descriptors) {
    if (!isFastifyNativeRouteMethod(descriptor.route.method)) {
      continue;
    }

    const routeKey = `${descriptor.route.method}:${descriptor.route.path}`;
    const current = grouped.get(routeKey) ?? { count: 0, hasVersioned: false };
    grouped.set(routeKey, {
      count: current.count + 1,
      hasVersioned: current.hasVersioned || descriptor.route.version !== undefined,
    });
  }

  const sensitive = new Set<string>();

  for (const [routeKey, value] of grouped) {
    if (value.count > 1 || value.hasVersioned) {
      sensitive.add(routeKey);
    }
  }

  return sensitive;
}
