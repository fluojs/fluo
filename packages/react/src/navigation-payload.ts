import type { ReactElement } from 'react';
import type { ReactPageMetadata } from './page-metadata.js';

const navigationPageKey = Symbol.for('fluo.react.navigationPage');

/** Build-mapped browser module and JSON props chosen by a matched page handler. */
export type ReactNavigationDestination = {
  readonly module: string;
  readonly props: Readonly<Record<string, unknown>>;
};

/** Version 1 response for a successfully matched React page. */
export type ReactNavigationPayload = {
  readonly version: 1;
  readonly url: string;
  readonly params: Readonly<Record<string, string>>;
  readonly destination: ReactNavigationDestination;
  readonly metadata?: ReactPageMetadata;
};

/** Validated initial document transfer for a handler-selected browser destination. */
export type ReactInitialNavigationPage = {
  readonly payload: ReactNavigationPayload;
  readonly json: string;
};

/**
 * Normalize a handler-selected destination through the existing JSON representation.
 *
 * @param url URL confirmed by HTTP matching.
 * @param params Path params confirmed by HTTP binding.
 * @param destination Browser module and JSON-only handler props.
 * @param metadata Optional bounded head descriptors resolved for the matched page.
 * @returns The representation shared by document hydration and soft navigation.
 */
export function createReactNavigationPayload(
  url: string,
  params: Readonly<Record<string, string>>,
  destination: ReactNavigationDestination,
  metadata?: ReactPageMetadata,
): ReactNavigationPayload {
  return {
    version: 1,
    url,
    params: { ...params },
    destination: {
      module: destination.module,
      props: JSON.parse(JSON.stringify(destination.props)),
    },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/**
 * Escape and bound an inert initial document transfer before HTML rendering starts.
 *
 * @param payload The HTTP-approved page representation to embed in the document.
 * @returns Validated payload with HTML-safe JSON text for an inert script.
 * @throws RangeError when escaped UTF-8 data exceeds 64 KiB.
 */
export function createReactInitialNavigationPage(payload: ReactNavigationPayload): ReactInitialNavigationPage {
  const json = JSON.stringify(payload).replace(/[<>&\u2028\u2029]/gu, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (new TextEncoder().encode(json).byteLength > 64 * 1024) {
    throw new RangeError('The initial React navigation page exceeds 64 KiB.');
  }
  return { payload, json };
}

/** A React page that can also describe a build-mapped browser destination. */
export type ReactNavigationPageResult = {
  readonly node: ReactElement;
  readonly destination: ReactNavigationDestination;
  readonly prefetch?: 'public';
};

/** Explicit opt-in to client navigation without changing ordinary React page returns. */
export class ReactNavigationPage {
  /**
   * Associates a server-rendered page with a build-mapped browser destination.
   *
   * @param node The ordinary page element passed to the application renderer for document GETs.
   * @param destination Browser module identity and JSON-serializable props produced by the handler.
   * @param options Optional public prefetch assertion for identity-independent pages.
   * @returns A page result that HTTP can negotiate after normal matching and pipeline execution.
   */
  static create(
    node: ReactElement,
    destination: ReactNavigationDestination,
    options?: { readonly prefetch: 'public' },
  ): ReactNavigationPageResult {
    const page: ReactNavigationPageResult = {
      node,
      destination: { module: destination.module, props: { ...destination.props } },
      ...(options === undefined ? {} : { prefetch: options.prefetch }),
    };
    Object.defineProperty(page, navigationPageKey, { value: true });
    return page;
  }
}

/**
 * Returns whether the value is an explicitly opted-in React page.
 *
 * @param value The value to check for an explicitly opted-in React page.
 * @returns Whether the value is a React navigation page result.
 */
export function isReactNavigationPage(value: unknown): value is ReactNavigationPageResult {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, navigationPageKey) === true;
}
