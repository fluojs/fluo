import type { FrameworkRequest } from '@fluojs/http';
import { cloneElement, isValidElement, type ReactNode } from 'react';

import type { ReactRenderContext } from './render.js';

const responseWriterKey = Symbol.for('fluo.http.responseWriter');

type ReactResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: ReactRenderContext;
};

type ReactAssetMapElementProps = {
  readonly assetMap?: ReactAssetMap;
};

/** Header values applied before a React server entry starts streaming. */
export type ReactServerEntryHeaders = Readonly<Record<string, string | readonly string[]>>;

/** Build-produced asset names mapped to public URLs shared by server render and client hydration. */
export type ReactAssetMap = Readonly<Record<string, string>>;

/** Descriptor for a bootstrap script or module tag emitted by React DOM server rendering. */
export type ReactBootstrapScriptDescriptor = {
  /** Public URL used for the script `src` attribute. */
  readonly src: string;
  /** Optional `crossorigin` attribute forwarded to the emitted script tag. */
  readonly crossOrigin?: string;
  /** Optional Subresource Integrity value forwarded to the emitted script tag. */
  readonly integrity?: string;
};

/** Bootstrap asset accepted by React DOM server rendering. */
export type ReactBootstrapAsset = string | ReactBootstrapScriptDescriptor;

/** Recoverable React render error details reported after the shell can stream. */
export type ReactRecoverableErrorContext = {
  /** React-provided error metadata, such as a component stack, when available. */
  readonly errorInfo?: unknown;
  /** Framework request being rendered. */
  readonly request: FrameworkRequest;
  /** Adapter-provided request id, when available. */
  readonly requestId?: string;
};

/** Hook invoked when React reports a recoverable streaming render error. */
export type ReactRecoverableErrorHandler = (
  error: unknown,
  context: ReactRecoverableErrorContext,
) => void;

/** Options used to create a React server entry. */
export type ReactServerEntryOptions = {
  /** Trusted build-produced asset map available to server rendering and client hydration code. */
  readonly assetMap?: ReactAssetMap;
  /** Module script URLs or descriptors forwarded to React DOM `bootstrapModules`. */
  readonly bootstrapModules?: readonly ReactBootstrapAsset[];
  /** Trusted inline bootstrap script content forwarded to React DOM without serialization. */
  readonly bootstrapScriptContent?: string;
  /** Classic script URLs or descriptors forwarded to React DOM `bootstrapScripts`. */
  readonly bootstrapScripts?: readonly ReactBootstrapAsset[];
  /** Additional response headers to apply before the HTML stream commits. */
  readonly headers?: ReactServerEntryHeaders;
  /** Stable React `useId()` prefix shared with client hydration. */
  readonly identifierPrefix?: string;
  /** CSP nonce applied by React DOM to emitted bootstrap scripts. */
  readonly nonce?: string;
  /** Hook for recoverable errors reported by React after the shell is ready. */
  readonly onRecoverableError?: ReactRecoverableErrorHandler;
  /** HTTP status to apply before streaming starts. Defaults to the current response status or `200`. */
  readonly status?: number;
};

/** Runtime-neutral React server entry rendered to streamed HTML by `renderReactResponse(...)`. */
export type ReactServerEntry = {
  /** Trusted build-produced asset map available to server rendering and client hydration code. */
  readonly assetMap: ReactAssetMap;
  /** Module script URLs or descriptors forwarded to React DOM `bootstrapModules`. */
  readonly bootstrapModules: readonly ReactBootstrapAsset[];
  /** Trusted inline bootstrap script content forwarded to React DOM without serialization. */
  readonly bootstrapScriptContent?: string;
  /** Classic script URLs or descriptors forwarded to React DOM `bootstrapScripts`. */
  readonly bootstrapScripts: readonly ReactBootstrapAsset[];
  /** Additional response headers to apply before the HTML stream commits. */
  readonly headers: ReactServerEntryHeaders;
  /** Stable React `useId()` prefix shared with client hydration. */
  readonly identifierPrefix?: string;
  /** React tree rendered with `react-dom/server` Web Streams APIs. */
  readonly node: ReactNode;
  /** CSP nonce applied by React DOM to emitted bootstrap scripts. */
  readonly nonce?: string;
  /** Hook for recoverable errors reported by React after the shell is ready. */
  readonly onRecoverableError?: ReactRecoverableErrorHandler;
  /** HTTP status to apply before streaming starts. Defaults to the current response status or `200`. */
  readonly status?: number;
};

function cloneAssetMap(assetMap: ReactAssetMap | undefined): ReactAssetMap {
  const cloned: Record<string, string> = {};
  Object.setPrototypeOf(cloned, null);

  for (const [name, url] of Object.entries(assetMap ?? {})) {
    cloned[name] = url;
  }

  return cloned;
}

function cloneBootstrapAsset(asset: ReactBootstrapAsset): ReactBootstrapAsset {
  if (typeof asset === 'string') {
    return asset;
  }

  return {
    ...(asset.crossOrigin !== undefined ? { crossOrigin: asset.crossOrigin } : {}),
    ...(asset.integrity !== undefined ? { integrity: asset.integrity } : {}),
    src: asset.src,
  };
}

function getBootstrapAssetSource(asset: ReactBootstrapAsset): string {
  return typeof asset === 'string' ? asset : asset.src;
}

function cloneUniqueBootstrapAssets(assets: readonly ReactBootstrapAsset[] | undefined): readonly ReactBootstrapAsset[] {
  const cloned: ReactBootstrapAsset[] = [];
  const seenSources = new Set<string>();

  for (const asset of assets ?? []) {
    const source = getBootstrapAssetSource(asset);

    if (seenSources.has(source)) {
      continue;
    }

    seenSources.add(source);
    cloned.push(cloneBootstrapAsset(asset));
  }

  return cloned;
}

function cloneHeaders(headers: ReactServerEntryHeaders | undefined): ReactServerEntryHeaders {
  const cloned: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    cloned[name] = typeof value === 'string' ? value : [...value];
  }

  return cloned;
}

function cloneNodeAssetMapProp(
  node: ReactNode,
  originalAssetMap: ReactAssetMap | undefined,
  assetMapSnapshot: ReactAssetMap,
): ReactNode {
  if (originalAssetMap === undefined || !isValidElement<ReactAssetMapElementProps>(node)) {
    return node;
  }

  if (node.props.assetMap !== originalAssetMap) {
    return node;
  }

  return cloneElement(node, { assetMap: assetMapSnapshot });
}

/**
 * Creates a runtime-neutral React server entry for streamed HTML rendering.
 *
 * @remarks
 * The entry is the stable root SSR handoff for page handlers registered through
 * `@Router(...)` and `@Path(...)`. It forwards explicit React DOM hydration asset
 * options only; Vite manifest discovery, client bundle generation, RSC, and Server
 * Functions remain outside the root `@fluojs/react` contract.
 *
 * @param node React node tree returned by a page handler.
 * @param options Optional status, headers, and recoverable error hook for the render.
 * @returns A defensive React server entry snapshot suitable for `renderReactResponse(...)`.
 */
export function createReactServerEntry(
  node: ReactNode,
  options: ReactServerEntryOptions = {},
): ReactServerEntry {
  const assetMap = cloneAssetMap(options.assetMap);
  const entry: ReactServerEntry = {
    assetMap,
    bootstrapModules: cloneUniqueBootstrapAssets(options.bootstrapModules),
    ...(options.bootstrapScriptContent !== undefined ? { bootstrapScriptContent: options.bootstrapScriptContent } : {}),
    bootstrapScripts: cloneUniqueBootstrapAssets(options.bootstrapScripts),
    headers: cloneHeaders(options.headers),
    ...(options.identifierPrefix !== undefined ? { identifierPrefix: options.identifierPrefix } : {}),
    node: cloneNodeAssetMapProp(node, options.assetMap, assetMap),
    ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
    ...(options.onRecoverableError !== undefined ? { onRecoverableError: options.onRecoverableError } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  };

  Object.defineProperty(entry, responseWriterKey, {
    enumerable: false,
    value: async (context: ReactResponseWriterContext): Promise<void> => {
      const { renderReactResponse } = await import('./render.js');
      await renderReactResponse(entry, context.requestContext, {
        applySuccessResponseMetadata: context.applySuccessResponseMetadata,
      });
    },
  });

  return entry;
}
