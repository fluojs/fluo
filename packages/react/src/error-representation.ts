import type { MaybePromise } from '@fluojs/core';
import type {
  HtmlErrorRepresentationProvider,
  HttpErrorRepresentationContext,
} from '@fluojs/http/portable';

import {
  type ReactReadableStreamRenderer,
  renderReactServerEntryToBytes,
} from './render.js';
import type { ReactServerEntry } from './server-entry.js';

/** Application callback that creates one React error document after HTTP classifies the outcome. */
export type ReactErrorDocumentRenderer = (
  context: HttpErrorRepresentationContext,
) => MaybePromise<ReactServerEntry>;

/** Options for adapting an application React document renderer to the HTTP HTML provider seam. */
export type ReactErrorRepresentationProviderOptions = {
  /** Optional route/application constraint evaluated by the HTTP dispatcher before rendering. */
  readonly canRender?: HtmlErrorRepresentationProvider['canRender'];
  /** Creates the complete React document for the already-classified HTTP outcome. */
  readonly renderDocument: ReactErrorDocumentRenderer;
  /** Optional Web Streams renderer override used by custom integrations and tests. */
  readonly renderToReadableStream?: ReactReadableStreamRenderer;
};

/**
 * Adapts an application-owned React document renderer to HTTP error representation negotiation.
 *
 * @remarks
 * Rendering is fully buffered before the HTTP dispatcher applies status, headers,
 * or commit. `ReactServerEntry.status` and `ReactServerEntry.headers` are ignored,
 * and this helper never performs matching or consults page render policies.
 *
 * @param options Application document renderer and optional availability/rendering hooks.
 * @returns An HTTP HTML provider registered through `errorRepresentation.html`.
 */
export function createReactErrorRepresentationProvider(
  options: ReactErrorRepresentationProviderOptions,
): HtmlErrorRepresentationProvider {
  return {
    ...(options.canRender === undefined ? {} : { canRender: options.canRender }),
    async render(context) {
      const entry = await options.renderDocument(context);
      return options.renderToReadableStream === undefined
        ? renderReactServerEntryToBytes(entry, context)
        : renderReactServerEntryToBytes(entry, context, options.renderToReadableStream);
    },
  };
}
