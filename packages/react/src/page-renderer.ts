import type { Token } from '@fluojs/core';
import type { ReactElement } from 'react';

import type { ReactRenderContext } from './render.js';
import type { ReactServerEntry } from './server-entry.js';

/**
 * Application-owned page composition callback registered through `ReactModule.forRoot(...)`.
 *
 * @remarks
 * The callback can wrap one page element with an application document, shared providers,
 * request-derived client route state, hydration assets, and recoverable-error policy. It must
 * return `ReactServerEntry` so the existing HTTP response-writer lifecycle remains authoritative.
 * Browser and Vite helpers stay application-owned and may be composed without widening the
 * runtime-neutral root import boundary.
 *
 * @param page React page element produced by an application handler.
 * @param context Active render context containing the matched request URL, params, and response.
 * @returns An existing React server entry finalized by the fluo HTTP dispatcher.
 */
export type ReactPageRenderer = (
  page: ReactElement,
  context: ReactRenderContext,
) => ReactServerEntry;

/** Dependency-injection token for the application `ReactPageRenderer`. */
export const REACT_PAGE_RENDERER: Token<ReactPageRenderer> = Symbol.for('fluo.react.page-renderer');
