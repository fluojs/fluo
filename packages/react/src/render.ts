import type { RequestContext } from '@fluojs/http';
import type { ReactNode } from 'react';

import type {
  ReactAssetMap,
  ReactBootstrapAsset,
  ReactBootstrapScriptDescriptor,
  ReactRecoverableErrorContext,
  ReactServerEntry,
} from './server-entry.js';
import { collectReadableStream, pipeReadableStream, throwIfReactRequestAborted } from './render-stream.js';

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

/** Readable stream returned by React's Web Streams SSR renderer. */
export type ReactReadableStream = ReadableStream<Uint8Array> & {
  /** Promise exposed by React for callers that intentionally wait for all Suspense boundaries. */
  readonly allReady?: Promise<void>;
};

/** React Web Streams render options used by `renderReactResponse(...)`. */
export type ReactReadableStreamRenderOptions = {
  /** Trusted build-produced asset map shared with custom server renderers and client hydration code. */
  readonly assetMap?: ReactAssetMap;
  /** Module script URLs or descriptors forwarded to React DOM `bootstrapModules`. */
  readonly bootstrapModules?: readonly ReactBootstrapAsset[];
  /** Trusted inline bootstrap script content forwarded to React DOM without serialization. */
  readonly bootstrapScriptContent?: string;
  /** Classic script URLs or descriptors forwarded to React DOM `bootstrapScripts`. */
  readonly bootstrapScripts?: readonly ReactBootstrapAsset[];
  /** Stable React `useId()` prefix shared with client hydration. */
  readonly identifierPrefix?: string;
  /** CSP nonce applied by React DOM to emitted bootstrap scripts. */
  readonly nonce?: string;
  /** Reports render errors observed by React during shell or Suspense streaming. */
  readonly onError?: (error: unknown, errorInfo?: unknown) => void;
  /** Abort signal propagated from the active fluo request when the adapter provides one. */
  readonly signal?: AbortSignal;
};

type MutableReactBootstrapScriptDescriptor = {
  crossOrigin?: string;
  integrity?: string;
  src: string;
};

type MutableReactBootstrapAsset = string | MutableReactBootstrapScriptDescriptor;

type ReactDomReadableStreamRenderOptions = {
  bootstrapModules?: MutableReactBootstrapAsset[];
  bootstrapScriptContent?: string;
  bootstrapScripts?: MutableReactBootstrapAsset[];
  identifierPrefix?: string;
  nonce?: string;
  onError?: (error: unknown, errorInfo?: unknown) => void;
  signal?: AbortSignal;
};

/** Function compatible with `react-dom/server` `renderToReadableStream`. */
export type ReactReadableStreamRenderer = (
  node: ReactNode,
  options: ReactReadableStreamRenderOptions,
) => Promise<ReactReadableStream>;

/** Options for rendering a React entry into one fluo response. */
export type RenderReactResponseOptions = {
  /** Applies dispatcher-owned success metadata after shell creation and before response commit. */
  readonly applySuccessResponseMetadata?: () => void;
  /** Test or custom renderer override. Defaults to lazy `react-dom/server` Web Streams rendering. */
  readonly renderToReadableStream?: ReactReadableStreamRenderer;
};

/** Minimal fluo request context needed to render one React HTML response. */
export type ReactRenderContext = Pick<RequestContext, 'request' | 'requestId' | 'response'>;

type PendingRecoverableError = {
  readonly error: unknown;
  readonly errorInfo?: unknown;
};

type ReactStreamWritePlan = {
  readonly applySuccessMetadata: () => void;
  readonly entry: ReactServerEntry;
  readonly pendingRecoverableErrors: readonly PendingRecoverableError[];
  readonly requestContext: ReactRenderContext;
  readonly stream: ReactReadableStream;
};

function applyEntryHeaders(entry: ReactServerEntry, requestContext: ReactRenderContext): void {
  for (const [name, value] of Object.entries(entry.headers)) {
    requestContext.response.setHeader(name, typeof value === 'string' ? value : [...value]);
  }

  requestContext.response.setHeader('Content-Type', HTML_CONTENT_TYPE);
}

function applyEntryStatus(entry: ReactServerEntry, requestContext: ReactRenderContext): void {
  if (entry.status !== undefined) {
    requestContext.response.setStatus(entry.status);
    return;
  }

  if (requestContext.response.statusSet !== true) {
    requestContext.response.setStatus(200);
  }
}

function cloneBootstrapDescriptor(asset: ReactBootstrapScriptDescriptor): MutableReactBootstrapScriptDescriptor {
  return {
    ...(asset.crossOrigin !== undefined ? { crossOrigin: asset.crossOrigin } : {}),
    ...(asset.integrity !== undefined ? { integrity: asset.integrity } : {}),
    src: asset.src,
  };
}

function cloneBootstrapAsset(asset: ReactBootstrapAsset): MutableReactBootstrapAsset {
  return typeof asset === 'string' ? asset : cloneBootstrapDescriptor(asset);
}

function cloneBootstrapAssets(assets: readonly ReactBootstrapAsset[] | undefined): MutableReactBootstrapAsset[] | undefined {
  return assets && assets.length > 0 ? assets.map(cloneBootstrapAsset) : undefined;
}

function hasAssetMap(assetMap: ReactAssetMap): boolean {
  return Object.keys(assetMap).length > 0;
}

function createReactReadableStreamRenderOptions(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  onError: (error: unknown, errorInfo?: unknown) => void,
): ReactReadableStreamRenderOptions {
  return {
    ...(hasAssetMap(entry.assetMap) ? { assetMap: entry.assetMap } : {}),
    ...(entry.bootstrapModules.length > 0 ? { bootstrapModules: entry.bootstrapModules } : {}),
    ...(entry.bootstrapScriptContent !== undefined ? { bootstrapScriptContent: entry.bootstrapScriptContent } : {}),
    ...(entry.bootstrapScripts.length > 0 ? { bootstrapScripts: entry.bootstrapScripts } : {}),
    ...(entry.identifierPrefix !== undefined ? { identifierPrefix: entry.identifierPrefix } : {}),
    ...(entry.nonce !== undefined ? { nonce: entry.nonce } : {}),
    onError,
    ...(requestContext.request.signal !== undefined ? { signal: requestContext.request.signal } : {}),
  };
}

function createReactDomRenderOptions(options: ReactReadableStreamRenderOptions): ReactDomReadableStreamRenderOptions {
  return {
    ...(options.bootstrapModules !== undefined ? { bootstrapModules: cloneBootstrapAssets(options.bootstrapModules) } : {}),
    ...(options.bootstrapScriptContent !== undefined ? { bootstrapScriptContent: options.bootstrapScriptContent } : {}),
    ...(options.bootstrapScripts !== undefined ? { bootstrapScripts: cloneBootstrapAssets(options.bootstrapScripts) } : {}),
    ...(options.identifierPrefix !== undefined ? { identifierPrefix: options.identifierPrefix } : {}),
    ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
}

function createRecoverableErrorContext(
  errorInfo: unknown,
  requestContext: ReactRenderContext,
): ReactRecoverableErrorContext {
  return {
    ...(errorInfo !== undefined ? { errorInfo } : {}),
    request: requestContext.request,
    ...(requestContext.requestId !== undefined ? { requestId: requestContext.requestId } : {}),
  };
}

function reportRecoverableError(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  event: PendingRecoverableError,
): void {
  const hook = entry.onRecoverableError;

  if (!hook) {
    return;
  }

  try {
    hook(event.error, createRecoverableErrorContext(event.errorInfo, requestContext));
  } catch (error) {
    if (error instanceof Error) {
      return;
    }
  }
}

function reportRecoverableErrors(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  events: readonly PendingRecoverableError[],
): void {
  for (const event of events) {
    reportRecoverableError(entry, requestContext, event);
  }
}

async function writeReactStream(plan: ReactStreamWritePlan): Promise<void> {
  const { applySuccessMetadata, entry, pendingRecoverableErrors, requestContext, stream } = plan;
  const responseStream = requestContext.response.stream;

  if (!responseStream) {
    const body = await collectReadableStream(stream, requestContext.request);
    throwIfReactRequestAborted(requestContext.request);
    applySuccessMetadata();
    reportRecoverableErrors(entry, requestContext, pendingRecoverableErrors);
    await requestContext.response.send(body);
    return;
  }

  applySuccessMetadata();
  requestContext.response.committed = true;
  responseStream.flush?.();
  reportRecoverableErrors(entry, requestContext, pendingRecoverableErrors);
  await pipeReadableStream(stream, responseStream, requestContext.request);
}

async function defaultRenderToReadableStream(
  node: ReactNode,
  options: ReactReadableStreamRenderOptions,
): Promise<ReactReadableStream> {
  const { renderToReadableStream } = await import('react-dom/server');

  return renderToReadableStream(node, createReactDomRenderOptions(options));
}

/**
 * Renders a React server entry to one fluo HTML response using Web Streams SSR.
 *
 * @param entry React server entry created by `createReactServerEntry(...)`.
 * @param requestContext Active fluo request context whose response receives the HTML stream.
 * @param options Optional custom renderer, primarily for tests and custom React DOM integration.
 * @returns A promise that resolves when the shell stream has been fully piped or a committed streaming response observes request abort.
 * @throws Shell render errors before any response bytes are committed.
 * @throws RequestAbortedError before buffered responses commit when the request aborts.
 */
export async function renderReactResponse(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  options: RenderReactResponseOptions = {},
): Promise<void> {
  throwIfReactRequestAborted(requestContext.request);

  const renderToReadableStream = options.renderToReadableStream ?? defaultRenderToReadableStream;
  const pendingRecoverableErrors: PendingRecoverableError[] = [];
  let shellReady = false;
  const stream = await renderToReadableStream(
    entry.node,
    createReactReadableStreamRenderOptions(entry, requestContext, (error, errorInfo) => {
      const event = errorInfo !== undefined ? { error, errorInfo } : { error };

      if (shellReady) {
        reportRecoverableError(entry, requestContext, event);
        return;
      }

      pendingRecoverableErrors.push(event);
    }),
  );

  shellReady = true;
  throwIfReactRequestAborted(requestContext.request);

  const applySuccessMetadata = () => {
    options.applySuccessResponseMetadata?.();
    applyEntryStatus(entry, requestContext);
    applyEntryHeaders(entry, requestContext);
  };

  await writeReactStream({ applySuccessMetadata, entry, pendingRecoverableErrors, requestContext, stream });
}
