import type { ReactNode } from 'react';

import type { ReactNavigationPayload } from '../navigation-payload.js';

const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=1';
const RESPONSE_MEDIA_TYPE = /^application\/vnd\.fluo\.react-navigation\+json;\s*v=(?:"1"|1)(?:;\s*charset=utf-8)?$/iu;

/** Build-produced, explicitly allowed client destination modules. */
export type ReactNavigationModules = Readonly<Record<
  string,
  () => Promise<{ readonly default: (props: Record<string, unknown>) => ReactNode }>
>>;

/** One uncached browser request's validated server result and loaded destination. */
export type ReactNavigationLoadResult =
  | {
    readonly ok: true;
    readonly payload: ReactNavigationPayload;
    readonly component: (props: Record<string, unknown>) => ReactNode;
  }
  | {
    readonly ok: false;
    readonly reason: 'cancelled' | 'invalid-payload' | 'unavailable' | 'unsupported-destination';
  };

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNavigationPayload(
  value: unknown,
  requested: URL,
  modules: ReactNavigationModules,
): ReactNavigationPayload | undefined {
  if (!isObject(value) || value.version !== 1 || typeof value.url !== 'string'
    || !value.url.startsWith('/') || value.url.startsWith('//')
    || !isStringRecord(value.params) || !isObject(value.destination)
    || typeof value.destination.module !== 'string' || !isObject(value.destination.props)
    || !Object.hasOwn(modules, value.destination.module)) {
    return undefined;
  }
  const confirmed = new URL(value.url, requested.origin);
  if (confirmed.origin !== requested.origin || confirmed.hash !== ''
    || `${confirmed.pathname}${confirmed.search}` !== `${requested.pathname}${requested.search}`) {
    return undefined;
  }
  return {
    version: 1,
    url: value.url,
    params: value.params,
    destination: { module: value.destination.module, props: value.destination.props },
  };
}

/**
 * Requests one HTTP-matched React page and resolves only a Vite-built destination module.
 *
 * @param href Same-origin HTTP(S) destination; no client route matching is performed.
 * @param modules Build-produced module importer map, for example Vite `import.meta.glob(...)`.
 * @param options Optional cancellation signal for this one request.
 * @returns The validated payload and component, or a reason to retain the native document path.
 */
export async function loadReactNavigationDestination(
  href: string | URL,
  modules: ReactNavigationModules,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ReactNavigationLoadResult> {
  const current = new URL(window.location.href);
  let destination: URL;
  try {
    destination = new URL(href, current);
  } catch (error) {
    if (error instanceof TypeError) {
      return { ok: false, reason: 'unsupported-destination' };
    }
    throw error;
  }
  if (!['http:', 'https:'].includes(destination.protocol) || destination.origin !== current.origin) {
    return { ok: false, reason: 'unsupported-destination' };
  }
  if (options.signal?.aborted) {
    return { ok: false, reason: 'cancelled' };
  }
  try {
    const response = await fetch(destination.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: MEDIA_TYPE },
      redirect: 'manual',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (options.signal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }
    if (!response.ok || response.redirected
      || !RESPONSE_MEDIA_TYPE.test(response.headers.get('Content-Type') ?? '')) {
      return { ok: false, reason: 'unavailable' };
    }
    const parsed: unknown = await response.json();
    if (options.signal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }
    const payload = parseNavigationPayload(parsed, destination, modules);
    if (payload === undefined) {
      return { ok: false, reason: 'invalid-payload' };
    }
    const loader = modules[payload.destination.module];
    if (loader === undefined) {
      return { ok: false, reason: 'invalid-payload' };
    }
    const module = await loader();
    if (options.signal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }
    if (typeof module.default !== 'function') {
      return { ok: false, reason: 'invalid-payload' };
    }
    return { ok: true, payload, component: module.default };
  } catch (error) {
    if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return { ok: false, reason: 'unavailable' };
    }
    throw error;
  }
}
