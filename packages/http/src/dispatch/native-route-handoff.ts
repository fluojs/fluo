import type { FrameworkRequest, HandlerMatch } from '../types.js';

const FRAMEWORK_REQUEST_NATIVE_ROUTE_HANDOFF = Symbol('fluo.http.nativeRouteHandoff');
const RAW_REQUEST_NATIVE_ROUTE_HANDOFFS = new WeakMap<object, HandlerMatch>();
const EMPTY_ROUTE_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

interface FrameworkRequestNativeRouteHandoffRecord {
  handoff: HandlerMatch;
  method: string;
  path: string;
}

type FrameworkRequestWithNativeRouteHandoff = FrameworkRequest & {
  [FRAMEWORK_REQUEST_NATIVE_ROUTE_HANDOFF]?: FrameworkRequestNativeRouteHandoffRecord;
};

function cloneNativeRouteHandoff(handoff: HandlerMatch): HandlerMatch {
  return {
    descriptor: handoff.descriptor,
    params: cloneRouteParams(handoff.params),
  };
}

function cloneRouteParams(params: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.keys(params).length === 0 ? EMPTY_ROUTE_PARAMS : { ...params };
}

/** Internal handoff payload that lets adapters skip duplicate route matching safely. */
export type NativeRouteHandoff = HandlerMatch;

/**
 * Associates one adapter-selected route handoff with a raw platform request.
 *
 * Platform adapters call this before translating the native request into a
 * `FrameworkRequest`, allowing the shared dispatcher to reuse the semantically
 * safe native match without changing the public dispatcher surface.
 *
 * @param rawRequest Raw platform request object used as the lookup key.
 * @param handoff Pre-matched descriptor and params selected by the adapter.
 */
export function bindRawRequestNativeRouteHandoff(rawRequest: object, handoff: NativeRouteHandoff): void {
  RAW_REQUEST_NATIVE_ROUTE_HANDOFFS.set(rawRequest, cloneNativeRouteHandoff(handoff));
}

/**
 * Reads and clears a native route handoff previously bound to a raw request.
 *
 * Request factories consume this once while constructing `FrameworkRequest`
 * instances so the handoff remains request-local and does not leak across
 * platform object reuse.
 *
 * @param rawRequest Raw platform request object used as the lookup key.
 * @returns The cloned handoff when one was registered for this request.
 */
export function consumeRawRequestNativeRouteHandoff(rawRequest: unknown): NativeRouteHandoff | undefined {
  if (typeof rawRequest !== 'object' || rawRequest === null) {
    return undefined;
  }

  const handoff = RAW_REQUEST_NATIVE_ROUTE_HANDOFFS.get(rawRequest);

  if (!handoff) {
    return undefined;
  }

  RAW_REQUEST_NATIVE_ROUTE_HANDOFFS.delete(rawRequest);
  return cloneNativeRouteHandoff(handoff);
}

/**
 * Stores a pre-matched native route handoff on one framework request.
 *
 * @param request Framework request that should carry the adapter-native match.
 * @param handoff Pre-matched descriptor and params selected by the adapter.
 * @returns The same request instance for fluent adapter construction.
 */
export function attachFrameworkRequestNativeRouteHandoff(
  request: FrameworkRequest,
  handoff: NativeRouteHandoff,
): FrameworkRequest {
  Reflect.set(
    request as FrameworkRequestWithNativeRouteHandoff,
    FRAMEWORK_REQUEST_NATIVE_ROUTE_HANDOFF,
    {
      handoff: cloneNativeRouteHandoff(handoff),
      method: request.method,
      path: request.path,
    },
  );

  return request;
}

/**
 * Reads a pre-matched native route handoff from one framework request.
 *
 * @param request Framework request being dispatched.
 * @returns The cloned handoff when the adapter supplied one.
 */
export function readFrameworkRequestNativeRouteHandoff(
  request: FrameworkRequest,
): NativeRouteHandoff | undefined {
  const record = Reflect.get(
    request as FrameworkRequestWithNativeRouteHandoff,
    FRAMEWORK_REQUEST_NATIVE_ROUTE_HANDOFF,
  ) as FrameworkRequestNativeRouteHandoffRecord | undefined;

  if (!record || record.method !== request.method || record.path !== request.path) {
    return undefined;
  }

  return cloneNativeRouteHandoff(record.handoff);
}

/**
 * Reports whether a request path depends on fluo's normalization semantics.
 *
 * Duplicate slashes and trailing slashes are intentionally normalized by the
 * shared matcher. Adapters use this helper to keep those requests on the
 * generic dispatcher path when native routing may not preserve identical path
 * selection semantics.
 *
 * @param path Raw framework request path.
 * @returns `true` when normalization would change the incoming path.
 */
export function isRoutePathNormalizationSensitive(path: string): boolean {
  return (path.length > 1 && path.endsWith('/')) || path.includes('//');
}
