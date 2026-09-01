import type { MaybePromise } from '@fluojs/core';

import {
  type ByteRangeResponseSource,
  writeByteRangeResponse,
} from './byte-range-response.js';
import { appendVaryHeader, readFirstNonEmptyRequestHeaderValue } from './header-helpers.js';
import {
  applyResponseValidators,
  resolveConditionalRequestRepresentation,
  writeConditionalResponse,
} from './dispatch/conditional-request-policy.js';
import type {
  Middleware,
  MiddlewareContext,
  ResponseValidators,
} from './types.js';

const defaultCacheControl = 'public, max-age=0';
const defaultDotfiles = 'ignore';

/** Content encodings that a static asset source may select. */
export type StaticAssetContentEncoding = 'br' | 'gzip';

/** Metadata for one selected static representation. */
export interface StaticAsset {
  /** Media type for the logical asset path. */
  readonly contentType: string;
  /** Optional representation encoding selected by the asset source. */
  readonly contentEncoding?: StaticAssetContentEncoding;
  /** Portable bytes or lazy stream factory for the selected representation. */
  readonly source: ByteRangeResponseSource;
  /** Exact selected representation length in bytes. */
  readonly size: number;
  /** Validators emitted and evaluated for the selected representation. */
  readonly validators?: ResponseValidators;
  /** Whether the source selected this representation from request encodings. */
  readonly variesByEncoding?: boolean;
}

/** Context supplied to an application-owned static asset source. */
export interface StaticAssetResolveContext {
  /** Ordered encodings accepted by the request. */
  readonly acceptedEncodings: readonly StaticAssetContentEncoding[];
  /** Request cancellation signal when the adapter exposes one. */
  readonly signal?: AbortSignal;
}

/** Runtime-neutral source for static asset representations. */
export interface StaticAssetSource {
  /**
   * Resolves a normalized relative asset path.
   *
   * Paths never begin with `/`, contain dot segments, path separators, backslashes,
   * NUL, or decoded URL separators.
   *
   * @param path Normalized relative asset path.
   * @param context Request capabilities relevant to source selection.
   * @returns The selected representation, or `undefined` when no asset exists.
   */
  resolve(path: string, context: StaticAssetResolveContext): MaybePromise<StaticAsset | undefined>;
}

/** Static asset middleware configuration. */
export interface StaticAssetsMiddlewareOptions {
  /** Required application-owned source; the portable layer never opens a filesystem itself. */
  readonly source: StaticAssetSource;
  /** URL prefix owned by this middleware. Defaults to `/`. */
  readonly prefix?: string;
  /** Dotfile policy. Defaults to `ignore`, which leaves the request to later middleware/routes. */
  readonly dotfiles?: 'allow' | 'deny' | 'ignore';
  /** Directory indexes resolved only for paths ending in `/`. Defaults to `false`. */
  readonly index?: false | string | readonly string[];
  /** Cache-Control value emitted for served and conditional responses. Defaults to `public, max-age=0`. */
  readonly cacheControl?: false | string;
}

/** Static middleware that serves a required explicit {@link StaticAssetSource}. */
export interface StaticAssetsMiddleware extends Middleware {}

/**
 * Creates portable static asset middleware without assuming filesystem access.
 *
 * @param options Source and URL/security policy for one static mount.
 * @returns Middleware that serves matching `GET` and `HEAD` asset requests.
 * @throws {TypeError} When configuration is structurally invalid.
 */
export function createStaticAssetsMiddleware(
  options: StaticAssetsMiddlewareOptions,
): StaticAssetsMiddleware {
  const configuration = resolveStaticAssetsConfiguration(options);

  return {
    async handle(context, next): Promise<void> {
      const assetPath = resolveStaticAssetPath(context.request.path, configuration.prefix, configuration.dotfiles);

      if (!assetPath || !isStaticAssetMethod(context.request.method)) {
        await next();
        return;
      }

      const asset = await resolveStaticAsset(
        configuration,
        assetPath,
        createStaticAssetResolveContext(context),
      );

      if (!asset) {
        await next();
        return;
      }

      if (configuration.cacheControl !== false) {
        context.response.setHeader('Cache-Control', configuration.cacheControl);
      }

      if (asset.contentEncoding) {
        context.response.setHeader('Content-Encoding', asset.contentEncoding);
      }

      if (asset.variesByEncoding) {
        appendVaryHeader(context.response, 'Accept-Encoding');
      }

      const conditional = resolveConditionalRequestRepresentation(context.request, {
        exists: true,
        validators: asset.validators,
      });

      if (conditional.outcome !== 'proceed') {
        await writeConditionalResponse(context.response, conditional.outcome, conditional.validators);
        return;
      }

      context.response.setStatus(200);
      await writeByteRangeResponse({
        applySuccessResponseMetadata: () => {
          applyResponseValidators(context.response, conditional.validators);
        },
        entry: {
          contentType: asset.contentType,
          size: asset.size,
          source: asset.source,
        },
        request: context.request,
        response: context.response,
        validators: conditional.validators,
      });
    },
  };
}

type StaticAssetsConfiguration = {
  readonly cacheControl: false | string;
  readonly dotfiles: 'allow' | 'deny' | 'ignore';
  readonly index: readonly string[];
  readonly prefix: string;
  readonly source: StaticAssetSource;
};

type StaticAssetPath = {
  readonly directory: boolean;
  readonly path: string;
};

function resolveStaticAssetsConfiguration(
  options: StaticAssetsMiddlewareOptions,
): StaticAssetsConfiguration {
  if (!options || typeof options !== 'object' || !options.source || typeof options.source.resolve !== 'function') {
    throw new TypeError('Static asset middleware requires an explicit asset source.');
  }

  const dotfiles = options.dotfiles ?? defaultDotfiles;

  if (dotfiles !== 'allow' && dotfiles !== 'deny' && dotfiles !== 'ignore') {
    throw new TypeError('Static asset dotfiles policy must be "allow", "deny", or "ignore".');
  }

  const cacheControl = options.cacheControl ?? defaultCacheControl;

  if (cacheControl !== false && (typeof cacheControl !== 'string' || cacheControl.trim() === '')) {
    throw new TypeError('Static asset cacheControl must be a non-empty string or false.');
  }

  return {
    cacheControl,
    dotfiles,
    index: normalizeIndex(options.index),
    prefix: normalizePrefix(options.prefix),
    source: options.source,
  };
}

function normalizePrefix(prefix: string | undefined): string {
  const value = prefix ?? '/';

  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new TypeError('Static asset prefix must begin with "/".');
  }

  const normalized = value.replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}

function normalizeIndex(index: StaticAssetsMiddlewareOptions['index']): readonly string[] {
  if (index === undefined || index === false) {
    return [];
  }

  const values = typeof index === 'string' ? [index] : index;

  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('Static asset index must be false, a non-empty filename, or a non-empty filename array.');
  }

  return values.map((value) => {
    if (
      typeof value !== 'string'
      || value === ''
      || value.includes('/')
      || value.includes('\\')
      || value === '.'
      || value === '..'
    ) {
      throw new TypeError('Static asset index names must be plain filenames.');
    }

    return value;
  });
}

function resolveStaticAssetPath(
  requestPath: string,
  prefix: string,
  dotfiles: StaticAssetsConfiguration['dotfiles'],
): StaticAssetPath | undefined {
  if (!matchesStaticPrefix(requestPath, prefix)) {
    return undefined;
  }

  const encodedPath = prefix === '/'
    ? requestPath
    : requestPath.slice(prefix.length);
  const directory = encodedPath.endsWith('/');
  const encodedSegments = encodedPath.split('/').filter((segment) => segment.length > 0);
  const segments: string[] = [];

  for (const encodedSegment of encodedSegments) {
    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      return undefined;
    }

    if (
      segment === ''
      || segment === '.'
      || segment === '..'
      || segment.includes('/')
      || segment.includes('\\')
      || segment.includes('\0')
    ) {
      return undefined;
    }

    if (segment.startsWith('.') && dotfiles !== 'allow') {
      return undefined;
    }

    segments.push(segment);
  }

  return { directory, path: segments.join('/') };
}

function matchesStaticPrefix(requestPath: string, prefix: string): boolean {
  return prefix === '/'
    ? requestPath.startsWith('/')
    : requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

function isStaticAssetMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

function createStaticAssetResolveContext(context: MiddlewareContext): StaticAssetResolveContext {
  return {
    acceptedEncodings: parseAcceptedEncodings(context),
    signal: context.request.signal,
  };
}

function parseAcceptedEncodings(context: MiddlewareContext): readonly StaticAssetContentEncoding[] {
  const value = readFirstNonEmptyRequestHeaderValue(context.request, 'accept-encoding');

  if (!value) {
    return [];
  }

  const selected: StaticAssetContentEncoding[] = [];

  for (const candidate of value.split(',')) {
    const [name, ...parameters] = candidate.trim().toLowerCase().split(';');
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const parsedQuality = quality ? Number(quality.trim().slice(2)) : 1;

    if (parsedQuality <= 0 || !Number.isFinite(parsedQuality)) {
      continue;
    }

    if ((name === 'br' || name === 'gzip') && !selected.includes(name)) {
      selected.push(name);
    }
  }

  return selected;
}

async function resolveStaticAsset(
  configuration: StaticAssetsConfiguration,
  assetPath: StaticAssetPath,
  context: StaticAssetResolveContext,
): Promise<StaticAsset | undefined> {
  if (assetPath.directory) {
    for (const indexName of configuration.index) {
      const asset = await configuration.source.resolve(
        assetPath.path === '' ? indexName : `${assetPath.path}/${indexName}`,
        context,
      );

      if (asset) {
        return asset;
      }
    }

    return undefined;
  }

  if (assetPath.path === '') {
    return undefined;
  }

  return await configuration.source.resolve(assetPath.path, context);
}
