import type { ReactNode } from 'react';

import type { ReactNavigationPayload } from '../navigation-payload.js';
import { parseReactPageMetadata } from '../page-metadata.js';

const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=2';
const RESPONSE_MEDIA_TYPE = /^application\/vnd\.fluo\.react-navigation\+json;\s*v=(?:"2"|2)(?:;\s*charset=utf-8)?$/iu;

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
    /** Only present after an explicitly granted, fully validated anonymous prefetch. */
    readonly prefetchExpiresAt?: number;
  }
  | {
    readonly ok: false;
    readonly reason: ReactNavigationFailureReason;
  };

/** Safe, machine-distinguishable reason; HTTP response bodies and thrown errors are never exposed. */
export type ReactNavigationFailureReason =
  | 'cancelled' | 'network' | 'server-error' | 'unauthorized' | 'forbidden'
  | 'redirect' | 'not-found' | 'dto-rejected' | 'invalid-payload'
  | 'incompatible-build' | 'unsupported-module' | 'import-failure' | 'unavailable' | 'unsupported-destination';

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
): ReactNavigationPayload | undefined {
  if (!isObject(value) || value.version !== 2
    || typeof value.buildId !== 'string' || value.buildId.length === 0
    || typeof value.url !== 'string'
    || !value.url.startsWith('/') || value.url.startsWith('//')
    || !isStringRecord(value.params) || !isObject(value.destination)
    || typeof value.destination.module !== 'string' || !isObject(value.destination.props)) {
    return undefined;
  }
  const metadata = value.metadata === undefined ? undefined : parseReactPageMetadata(value.metadata);
  if (value.metadata !== undefined && metadata === undefined) {
    return undefined;
  }
  const confirmed = new URL(value.url, requested.origin);
  if (confirmed.origin !== requested.origin || confirmed.hash !== ''
    || `${confirmed.pathname}${confirmed.search}` !== `${requested.pathname}${requested.search}`) {
    return undefined;
  }
  return {
    version: 2,
    buildId: value.buildId,
    url: value.url,
    params: value.params,
    destination: { module: value.destination.module, props: value.destination.props },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/**
 * Resolve the HTTP-selected initial document page from the built importer map before hydration.
 *
 * @param json Escaped JSON text from the inert initial-page script in the server document.
 * @param modules Build-produced destination importers shared with soft navigation.
 * @returns The validated component and HTTP request snapshot, or an unavailable destination.
 */
export async function loadReactInitialNavigationDestination(
  json: string,
  modules: ReactNavigationModules,
  buildId?: string,
): Promise<ReactNavigationLoadResult> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, reason: 'invalid-payload' };
    }
    throw error;
  }
  const payload = parseNavigationPayload(value, new URL(window.location.href));
  if (payload === undefined) {
    return { ok: false, reason: 'invalid-payload' };
  }
  if (buildId === undefined || buildId.length === 0) {
    return { ok: false, reason: 'invalid-payload' };
  }
  if (payload.buildId !== buildId) {
    return { ok: false, reason: 'incompatible-build' };
  }
  const loader = Object.hasOwn(modules, payload.destination.module)
    ? modules[payload.destination.module] : undefined;
  if (loader === undefined) {
    return { ok: false, reason: 'invalid-payload' };
  }
  try {
    const module = await loader();
    return typeof module.default === 'function'
      ? { ok: true, payload, component: module.default }
      : { ok: false, reason: 'invalid-payload' };
  } catch (error) {
    if (error instanceof TypeError) {
      return { ok: false, reason: 'unavailable' };
    }
    throw error;
  }
}

function prefetchFreshUntil(headers: Headers, receivedAt: number): number | undefined {
  if (headers.get('X-Fluo-Navigation-Prefetch') !== 'public'
    || headers.get('Vary')?.trim().toLowerCase() !== 'accept') {
    return undefined;
  }
  const cacheControl = /^public,\s*max-age=(\d+)$/iu.exec(headers.get('Cache-Control')?.trim() ?? '');
  const age = headers.get('Age')?.trim() ?? '0';
  if (cacheControl === null || !/^\d+$/u.test(age)) {
    return undefined;
  }
  const seconds = Number(cacheControl[1]);
  const elapsed = Number(age);
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(elapsed)
    || seconds <= elapsed || seconds <= 0) {
    return undefined;
  }
  return receivedAt + Math.min(15, seconds - elapsed) * 1000;
}

async function readBoundedNavigationJson(response: Response): Promise<unknown> {
  if (response.body === null) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > 64 * 1024 ? undefined : JSON.parse(text);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let json = '';
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > 64 * 1024) {
        await reader.cancel();
        return undefined;
      }
      json += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

/**
 * Requests one HTTP-matched React page and resolves only a Vite-built destination module.
 *
 * @param href Same-origin HTTP(S) destination; no client route matching is performed.
 * @param modules Build-produced module importer map, for example Vite `import.meta.glob(...)`.
 * @param options Optional cancellation signal and anonymous prefetch mode for this one request.
 * @returns The validated payload and component, or a reason to retain the native document path.
 */
export async function loadReactNavigationDestination(
  href: string | URL,
  modules: ReactNavigationModules,
  options: { readonly signal?: AbortSignal; readonly prefetch?: true; readonly buildId?: string } = {},
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
  const receivedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(destination.href, {
      cache: 'no-store',
      credentials: options.prefetch === true ? 'omit' : 'same-origin',
      headers: { Accept: MEDIA_TYPE },
      redirect: 'manual',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'network' };
  }
  if (options.signal?.aborted) {
    return { ok: false, reason: 'cancelled' };
  }
  if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
    return { ok: false, reason: 'redirect' };
  }
  if (!response.ok) {
    const reason = response.status >= 500 ? 'server-error'
      : response.status === 401 ? 'unauthorized'
        : response.status === 403 ? 'forbidden'
          : response.status === 404 ? 'not-found'
            : response.status === 400 || response.status === 422 ? 'dto-rejected' : 'unavailable';
    return { ok: false, reason };
  }
  if (!RESPONSE_MEDIA_TYPE.test(response.headers.get('Content-Type') ?? '')) {
    return { ok: false, reason: 'invalid-payload' };
  }
  try {
    const freshUntil = options.prefetch === true
      ? prefetchFreshUntil(response.headers, receivedAt)
      : undefined;
    if (options.prefetch === true && (response.status !== 200 || freshUntil === undefined)) {
      await response.body?.cancel();
      return { ok: false, reason: 'unavailable' };
    }
    let parsed: unknown;
    try {
      parsed = options.prefetch === true
        ? await readBoundedNavigationJson(response)
        : await response.json();
    } catch (error) {
      if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, reason: 'cancelled' };
      }
      if (error instanceof TypeError) {
        return { ok: false, reason: 'network' };
      }
      throw error;
    }
    if (options.signal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }
    const payload = parseNavigationPayload(parsed, destination);
    if (payload === undefined) {
      return { ok: false, reason: 'invalid-payload' };
    }
    if (options.buildId === undefined || options.buildId.length === 0) {
      return { ok: false, reason: 'invalid-payload' };
    }
    if (payload.buildId !== options.buildId) {
      return { ok: false, reason: 'incompatible-build' };
    }
    if (!Object.hasOwn(modules, payload.destination.module)) {
      return { ok: false, reason: 'unsupported-module' };
    }
    const loader = modules[payload.destination.module];
    if (loader === undefined) {
      return { ok: false, reason: 'unsupported-module' };
    }
    let module: Awaited<ReturnType<typeof loader>>;
    try {
      module = await loader();
    } catch {
      return options.signal?.aborted
        ? { ok: false, reason: 'cancelled' }
        : { ok: false, reason: 'import-failure' };
    }
    if (options.signal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }
    if (typeof module.default !== 'function') {
      return { ok: false, reason: 'invalid-payload' };
    }
    if (options.prefetch === true) {
      return freshUntil !== undefined && Date.now() < freshUntil
        ? { ok: true, payload, component: module.default, prefetchExpiresAt: Math.min(freshUntil, Date.now() + 15_000) }
        : { ok: false, reason: 'unavailable' };
    }
    return { ok: true, payload, component: module.default };
  } catch (error) {
    if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return { ok: false, reason: 'invalid-payload' };
    }
    throw error;
  }
}
