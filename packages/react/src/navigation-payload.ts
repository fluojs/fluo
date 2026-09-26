import type { ReactElement } from 'react';

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
};

/** A React page that can also describe a build-mapped browser destination. */
export type ReactNavigationPageResult = {
  readonly node: ReactElement;
  readonly destination: ReactNavigationDestination;
};

/** Explicit opt-in to client navigation without changing ordinary React page returns. */
export class ReactNavigationPage {
  /**
   * Associates a server-rendered page with a build-mapped browser destination.
   *
   * @param node The ordinary page element passed to the application renderer for document GETs.
   * @param destination Browser module identity and JSON-serializable props produced by the handler.
   * @returns A page result that HTTP can negotiate after normal matching and pipeline execution.
   */
  static create(node: ReactElement, destination: ReactNavigationDestination): ReactNavigationPageResult {
    const page: ReactNavigationPageResult = {
      node,
      destination: { module: destination.module, props: { ...destination.props } },
    };
    Object.defineProperty(page, navigationPageKey, { value: true });
    return page;
  }
}

/** Returns whether the value is an explicitly opted-in React page. */
export function isReactNavigationPage(value: unknown): value is ReactNavigationPageResult {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, navigationPageKey) === true;
}
