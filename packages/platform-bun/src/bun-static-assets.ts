import { createHash } from 'node:crypto';
import { constants, realpathSync, statSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  StaticAssetAcceptedEncoding,
  StaticAssetResolution,
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

/** Precompressed sibling selection for a Bun filesystem source. */
export type BunFileSystemAssetPrecompression = boolean | {
  /** Whether `.br` siblings are eligible; defaults to `true`. */
  readonly brotli?: boolean;
  /** Whether `.gz` siblings are eligible; defaults to `true`. */
  readonly gzip?: boolean;
};

/** Existing filesystem directory and optional precompressed representations. */
export interface BunFileSystemAssetSourceOptions {
  /** Directory containing the assets to serve. */
  readonly root: string;
  /** Whether to select accepted `.br` and `.gz` siblings; defaults to `false`. */
  readonly precompressed?: BunFileSystemAssetPrecompression;
}

/**
 * Creates a Bun-supported filesystem source for `createStaticAssetsMiddleware`.
 *
 * @param options Existing asset root and optional precompressed sibling policy.
 * @returns A portable source that snapshots verified file bytes before responding.
 * @throws {TypeError} If the root does not name an existing directory.
 *
 * @example
 * ```ts
 * createStaticAssetsMiddleware({
 *   prefix: '/assets',
 *   source: createBunFileSystemAssetSource({ root: './dist/client' }),
 * });
 * ```
 */
export function createBunFileSystemAssetSource(
  options: BunFileSystemAssetSourceOptions,
): StaticAssetSource {
  if (!options || typeof options.root !== 'string' || options.root.trim() === '') {
    throw new TypeError('Bun filesystem static asset root must be a non-empty string.');
  }

  let root: string;
  try {
    root = realpathSync(resolve(options.root));
  } catch {
    throw new TypeError('Bun filesystem static asset root must be an existing directory.');
  }

  if (!statSync(root).isDirectory()) {
    throw new TypeError('Bun filesystem static asset root must be a directory.');
  }

  const precompressed = options.precompressed;
  if (precompressed !== undefined && typeof precompressed !== 'boolean' && (
    !precompressed
    || typeof precompressed !== 'object'
    || (precompressed.brotli !== undefined && typeof precompressed.brotli !== 'boolean')
    || (precompressed.gzip !== undefined && typeof precompressed.gzip !== 'boolean')
  )) {
    throw new TypeError('Bun filesystem static asset precompressed must be a boolean or an object of booleans.');
  }

  const brotli = precompressed === true || (typeof precompressed === 'object' && precompressed?.brotli !== false);
  const gzip = precompressed === true || (typeof precompressed === 'object' && precompressed?.gzip !== false);

  return {
    async resolve(path, context): Promise<StaticAssetResolution> {
      if (
        typeof path !== 'string'
        || path === ''
        || path.includes('\0')
        || isAbsolute(path)
        || path.split('/').some((segment) =>
          segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))
      ) {
        return undefined;
      }

      const extensions = [
        ...(brotli ? [{ encoding: 'br' as const, suffix: '.br' }] : []),
        ...(gzip ? [{ encoding: 'gzip' as const, suffix: '.gz' }] : []),
        { encoding: 'identity' as const, suffix: '' },
      ];
      let selected: { bytes: Uint8Array; lastModified: Date } | undefined;
      let selectedEncoding: StaticAssetAcceptedEncoding = 'identity';

      for (const encoding of context.acceptedEncodings) {
        const representation = extensions.find((candidate) => candidate.encoding === encoding);
        if (!representation) {
          continue;
        }
        selected = await openContainedAsset(root, `${path}${representation.suffix}`);
        if (selected) {
          selectedEncoding = encoding;
          break;
        }
      }

      if (!selected) {
        for (const representation of extensions) {
          if (await openContainedAsset(root, `${path}${representation.suffix}`)) {
            return { notAcceptable: true };
          }
        }
        return undefined;
      }

      const variesByEncoding = selectedEncoding !== 'identity'
        || (brotli && !!await openContainedAsset(root, `${path}.br`))
        || (gzip && !!await openContainedAsset(root, `${path}.gz`));

      return {
        contentEncoding: selectedEncoding === 'br' || selectedEncoding === 'gzip'
          ? selectedEncoding
          : undefined,
        contentType: mimeTypes[extname(path)] ?? 'application/octet-stream',
        size: selected.bytes.byteLength,
        source: selected.bytes,
        validators: {
          etag: {
            opaqueValue: createHash('sha256').update(selected.bytes).digest('base64url'),
            strength: 'strong',
          },
          lastModified: selected.lastModified,
        },
        variesByEncoding,
      };
    },
  };
}

async function openContainedAsset(
  root: string,
  path: string,
): Promise<{ bytes: Uint8Array; lastModified: Date } | undefined> {
  try {
    const resolvedPath = await realpath(resolve(root, path));
    const fromRoot = relative(root, resolvedPath);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      return undefined;
    }

    const expected = await stat(resolvedPath, { bigint: true });
    if (!expected.isFile()) {
      return undefined;
    }

    const handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat({ bigint: true });
      if (!metadata.isFile() || metadata.dev !== expected.dev || metadata.ino !== expected.ino) {
        return undefined;
      }

      const openedPath = await realpath(resolvedPath);
      const openedFromRoot = relative(root, openedPath);
      if (openedFromRoot === '..' || openedFromRoot.startsWith(`..${sep}`) || isAbsolute(openedFromRoot)) {
        return undefined;
      }
      const current = await stat(openedPath, { bigint: true });
      if (!current.isFile() || current.dev !== metadata.dev || current.ino !== metadata.ino) {
        return undefined;
      }

      const bytes = new Uint8Array(await handle.readFile());
      return { bytes, lastModified: new Date(Number(metadata.mtimeMs)) };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP')) {
      return undefined;
    }
    throw error;
  }
}
