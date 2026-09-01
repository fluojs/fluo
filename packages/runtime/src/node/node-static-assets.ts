import { createReadStream, realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

import type {
  StaticAsset,
  StaticAssetContentEncoding,
  StaticAssetResolveContext,
  StaticAssetSource,
} from '@fluojs/http';

const mimeTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'application/javascript',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
};

/** Precompressed representation policy for a Node filesystem asset source. */
export type NodeFileSystemAssetPrecompression = boolean | {
  /** Whether `.br` siblings may be selected. Defaults to `true`. */
  readonly brotli?: boolean;
  /** Whether `.gz` siblings may be selected. Defaults to `true`. */
  readonly gzip?: boolean;
};

/** Configuration for a Node filesystem-backed static asset source. */
export interface NodeFileSystemAssetSourceOptions {
  /** Existing directory that contains all served asset files. */
  readonly root: string;
  /** Optional precompressed sibling selection policy. Defaults to `false`. */
  readonly precompressed?: NodeFileSystemAssetPrecompression;
}

/**
 * Creates a Node-only filesystem source for {@link StaticAssetSource}.
 *
 * @param options Existing root directory and optional precompressed sibling policy.
 * @returns An explicit portable source that lazily opens verified files.
 * @throws {TypeError} When the root is empty, missing, or not a directory.
 */
export function createNodeFileSystemAssetSource(
  options: NodeFileSystemAssetSourceOptions,
): StaticAssetSource {
  const root = resolveNodeAssetRoot(options);
  const precompressed = resolvePrecompression(options.precompressed);

  return {
    async resolve(path, context): Promise<StaticAsset | undefined> {
      const logicalPath = resolveRelativeAssetPath(root, path);

      if (!logicalPath) {
        return undefined;
      }

      const selected = await selectRepresentation(logicalPath, context.acceptedEncodings, precompressed);

      if (!selected) {
        return undefined;
      }

      const resolvedPath = await resolveExistingAsset(root, selected.path);

      if (!resolvedPath) {
        return undefined;
      }

      const metadata = await readAssetMetadata(resolvedPath);

      if (!metadata) {
        return undefined;
      }

      return {
        contentEncoding: selected.encoding,
        contentType: mimeTypes[extname(logicalPath)] ?? 'application/octet-stream',
        source: () => Readable.toWeb(createReadStream(resolvedPath)) as ReadableStream<Uint8Array>,
        size: metadata.size,
        validators: {
          etag: {
            opaqueValue: `${metadata.size.toString(16)}-${metadata.lastModified.getTime().toString(16)}`,
            strength: 'weak',
          },
          lastModified: metadata.lastModified,
        },
        variesByEncoding: precompressed.brotli || precompressed.gzip,
      };
    },
  };
}

type ResolvedPrecompression = {
  readonly brotli: boolean;
  readonly gzip: boolean;
};

type SelectedRepresentation = {
  readonly encoding?: StaticAssetContentEncoding;
  readonly path: string;
};

function resolveNodeAssetRoot(options: NodeFileSystemAssetSourceOptions): string {
  if (!options || typeof options !== 'object' || typeof options.root !== 'string' || options.root.trim() === '') {
    throw new TypeError('Node filesystem static asset root must be a non-empty string.');
  }

  let root: string;
  try {
    root = realpathSync(resolve(options.root));
  } catch {
    throw new TypeError('Node filesystem static asset root must be an existing directory.');
  }

  if (!statSync(root).isDirectory()) {
    throw new TypeError('Node filesystem static asset root must be a directory.');
  }

  return root;
}

function resolvePrecompression(
  value: NodeFileSystemAssetPrecompression | undefined,
): ResolvedPrecompression {
  if (value === undefined || value === false) {
    return { brotli: false, gzip: false };
  }

  if (value === true) {
    return { brotli: true, gzip: true };
  }

  if (typeof value !== 'object') {
    throw new TypeError('Node filesystem static asset precompressed must be a boolean or an object.');
  }

  return {
    brotli: value.brotli ?? true,
    gzip: value.gzip ?? true,
  };
}

function resolveRelativeAssetPath(root: string, path: string): string | undefined {
  if (
    typeof path !== 'string'
    || path === ''
    || path.includes('\0')
    || isAbsolute(path)
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))
  ) {
    return undefined;
  }

  const candidate = resolve(root, ...path.split('/'));
  return isWithinRoot(root, candidate) ? candidate : undefined;
}

async function selectRepresentation(
  logicalPath: string,
  acceptedEncodings: readonly StaticAssetContentEncoding[],
  precompressed: ResolvedPrecompression,
): Promise<SelectedRepresentation | undefined> {
  for (const encoding of acceptedEncodings) {
    if ((encoding === 'br' && !precompressed.brotli) || (encoding === 'gzip' && !precompressed.gzip)) {
      continue;
    }

    const extension = encoding === 'br' ? '.br' : '.gz';
    const candidate = `${logicalPath}${extension}`;
    const metadata = await readAssetMetadata(candidate);

    if (metadata) {
      return { encoding, path: candidate };
    }
  }

  return { path: logicalPath };
}

async function resolveExistingAsset(root: string, path: string): Promise<string | undefined> {
  try {
    const resolvedPath = await realpath(path);
    return isWithinRoot(root, resolvedPath) ? resolvedPath : undefined;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readAssetMetadata(path: string): Promise<{ readonly lastModified: Date; readonly size: number } | undefined> {
  try {
    const metadata = await stat(path);

    if (!metadata.isFile()) {
      return undefined;
    }

    return {
      lastModified: new Date(Math.floor(metadata.mtimeMs / 1000) * 1000),
      size: metadata.size,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isWithinRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
