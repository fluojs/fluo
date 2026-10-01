import type { ReactElement } from 'react';
import type { ReactPageMetadata } from './page-metadata.js';

const navigationPageKey = Symbol.for('fluo.react.navigationPage');

/** Application typegen augments this registry with browser module identities and JSON props. */
export interface ReactPagePropsRegistry {}

/** Build-mapped browser module and JSON props chosen by a matched page handler. */
export type ReactNavigationDestination<Props extends object = Readonly<Record<string, unknown>>> = {
  readonly module: string;
  readonly props: Props;
};

/** Version 2 response for a successfully matched React page. */
export type ReactNavigationPayload = {
  readonly version: 2;
  readonly buildId: string;
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
 * @param buildId Application-owned build identity shared by the document and navigation response.
 * @param metadata Optional bounded head descriptors resolved for the matched page.
 * @returns The representation shared by document hydration and soft navigation.
 */
export function createReactNavigationPayload(
  url: string,
  params: Readonly<Record<string, string>>,
  destination: ReactNavigationDestination,
  buildId: string,
  metadata?: ReactPageMetadata,
): ReactNavigationPayload {
  return {
    version: 2,
    buildId,
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
export type ReactNavigationPageResult<Destination extends ReactNavigationDestination<object> = ReactNavigationDestination> = {
  readonly node: ReactElement;
  readonly destination: Destination;
  readonly prefetch?: 'public';
};

type ExactProps<Actual, Expected> = Expected extends object
  ? Actual extends Expected ? Actual & Record<Exclude<keyof Actual, keyof Expected>, never> : never : never;

type RegisteredDestination<Destination extends ReactNavigationDestination<object>> =
  [keyof ReactPagePropsRegistry] extends [never] ? Destination
    : Destination['module'] extends keyof ReactPagePropsRegistry
      ? { readonly module: Destination['module']; readonly props: ExactProps<Destination['props'], ReactPagePropsRegistry[Destination['module']]> }
      : never;

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
  static create<const Destination extends ReactNavigationDestination<object>>(
    node: ReactElement,
    destination: Destination & RegisteredDestination<Destination>,
    options?: { readonly prefetch: 'public' },
  ): ReactNavigationPageResult<Destination> {
    const page: ReactNavigationPageResult<Destination> = {
      node,
      destination: { ...destination, props: { ...destination.props } },
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
