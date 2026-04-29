import { InvalidRoutePathError } from './errors.js';

/**
 * Describes the route path literal segment contract.
 */
export interface RoutePathLiteralSegment {
  kind: 'literal';
  value: string;
}

/**
 * Describes the route path param segment contract.
 */
export interface RoutePathParamSegment {
  kind: 'param';
  name: string;
}

/**
 * Defines the route path segment type.
 */
export type RoutePathSegment = RoutePathLiteralSegment | RoutePathParamSegment;

const routeParamNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const unsupportedLiteralTokenPattern = /[*?+()[\]{}\\]/;
const supportedRouteSyntaxDescription = 'Only literal segments and full-segment ":param" placeholders are supported.';

function normalizeLabel(label: string | undefined): string {
  const value = label?.trim();
  return value && value.length > 0 ? value : 'Route path';
}

function describeSegment(segment: string): string {
  return `"${segment}"`;
}

function throwInvalidRoutePath(
  label: string | undefined,
  path: string,
  segment: string,
  reason: string,
): never {
  throw new InvalidRoutePathError(
    `${normalizeLabel(label)} "${path}" is invalid at segment ${describeSegment(segment)}: ${reason}. ${supportedRouteSyntaxDescription}`,
  );
}

function parseRoutePathSegment(segment: string, path: string, label?: string): RoutePathSegment {
  if (segment.startsWith(':')) {
    const paramName = segment.slice(1);

    if (!routeParamNamePattern.test(paramName)) {
      throwInvalidRoutePath(label, path, segment, 'Parameter names must match /[a-zA-Z_][a-zA-Z0-9_]*/');
    }

    return {
      kind: 'param',
      name: paramName,
    };
  }

  if (segment.includes(':')) {
    throwInvalidRoutePath(label, path, segment, 'Parameters must occupy the entire segment');
  }

  if (unsupportedLiteralTokenPattern.test(segment)) {
    throwInvalidRoutePath(label, path, segment, 'Wildcards, regex-like tokens, and inline modifiers are not supported');
  }

  return {
    kind: 'literal',
    value: segment,
  };
}

/**
 * Normalize route path.
 *
 * @param path The path.
 * @returns The normalize route path result.
 */
export function normalizeRoutePath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const normalized = `/${segments.join('/')}`;

  return normalized === '' ? '/' : normalized;
}

/**
 * Parse route path.
 *
 * @param path The path.
 * @param label The label.
 * @returns The parse route path result.
 */
export function parseRoutePath(path: string, label?: string): RoutePathSegment[] {
  const normalizedPath = normalizeRoutePath(path);
  const segments = normalizedPath.split('/').filter(Boolean);

  return segments.map((segment) => parseRoutePathSegment(segment, path, label));
}

/**
 * Validate route path.
 *
 * @param path The path.
 * @param label The label.
 */
export function validateRoutePath(path: string, label?: string): void {
  void parseRoutePath(path, label);
}

/**
 * Extract route path params.
 *
 * @param path The path.
 * @returns The extract route path params result.
 */
export function extractRoutePathParams(path: string): string[] {
  return parseRoutePath(path).flatMap((segment) => segment.kind === 'param' ? [segment.name] : []);
}

/**
 * Match route path.
 *
 * @param registeredSegments The registered segments.
 * @param incomingSegments The incoming segments.
 * @returns The match route path result.
 */
export function matchRoutePath(
  registeredSegments: readonly RoutePathSegment[],
  incomingSegments: readonly string[],
): Readonly<Record<string, string>> | undefined {
  if (registeredSegments.length !== incomingSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};

  for (const [index, segment] of registeredSegments.entries()) {
    const incoming = incomingSegments[index];

    if (segment.kind === 'param') {
      params[segment.name] = incoming;
      continue;
    }

    if (segment.value !== incoming) {
      return undefined;
    }
  }

  return params;
}
