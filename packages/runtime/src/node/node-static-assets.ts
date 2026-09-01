import { constants, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import type {
  StaticAsset,
  StaticAssetAcceptedEncoding,
  StaticAssetContentEncoding,
  StaticAssetResolveContext,
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
    async resolve(path, context): Promise<StaticAssetResolution> {
      const logicalPath = resolveRelativeAssetPath(root, path);

      if (!logicalPath) {
        return undefined;
      }

      const selected = await selectRepresentation(root, logicalPath, context.acceptedEncodings, precompressed);

      if (!selected) {
        return await hasExistingRepresentation(root, logicalPath, precompressed)
          ? { notAcceptable: true }
          : undefined;
      }

      return {
        contentEncoding: selected.representation.encoding,
        contentType: mimeTypes[extname(logicalPath)] ?? 'application/octet-stream',
        source: () => createSnapshotStream(selected.bytes),
        size: selected.metadata.size,
        validators: {
          etag: {
            opaqueValue: createAssetEtag(selected.bytes),
            strength: 'strong',
          },
          lastModified: selected.metadata.lastModified,
        },
        variesByEncoding: selected.variesByEncoding,
      };
    },
  };
}

type ResolvedPrecompression = {
  readonly brotli: boolean;
  readonly gzip: boolean;
};

type ResolvedRoot = {
  readonly device: bigint;
  readonly inode: bigint;
  readonly path: string;
};

type SelectedRepresentation = {
  readonly encoding?: StaticAssetContentEncoding;
  readonly path: string;
};

type OpenedAsset = {
  readonly bytes: Uint8Array;
  readonly metadata: AssetMetadata;
};

type AssetMetadata = {
  readonly device: bigint;
  readonly inode: bigint;
  readonly lastModified: Date;
  readonly size: number;
};

type SelectedOpenedRepresentation = {
  readonly bytes: Uint8Array;
  readonly metadata: AssetMetadata;
  readonly representation: SelectedRepresentation;
  readonly variesByEncoding: boolean;
};

function resolveNodeAssetRoot(options: NodeFileSystemAssetSourceOptions): ResolvedRoot {
  if (!options || typeof options !== 'object' || typeof options.root !== 'string' || options.root.trim() === '') {
    throw new TypeError('Node filesystem static asset root must be a non-empty string.');
  }

  let root: string;
  try {
    root = realpathSync(resolve(options.root));
  } catch {
    throw new TypeError('Node filesystem static asset root must be an existing directory.');
  }

  const metadata = statSync(root, { bigint: true });

  if (!metadata.isDirectory()) {
    throw new TypeError('Node filesystem static asset root must be a directory.');
  }

  return {
    device: metadata.dev,
    inode: metadata.ino,
    path: root,
  };
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

function resolveRelativeAssetPath(root: ResolvedRoot, path: string): string | undefined {
  if (
    typeof path !== 'string'
    || path === ''
    || path.includes('\0')
    || isAbsolute(path)
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))
  ) {
    return undefined;
  }

  const candidate = resolve(root.path, ...path.split('/'));
  return isWithinRoot(root.path, candidate) ? path : undefined;
}

async function selectRepresentation(
  root: ResolvedRoot,
  logicalPath: string,
  acceptedEncodings: readonly StaticAssetAcceptedEncoding[],
  precompressed: ResolvedPrecompression,
): Promise<SelectedOpenedRepresentation | undefined> {
  for (const encoding of acceptedEncodings) {
    if (
      (encoding === 'br' && !precompressed.brotli)
      || (encoding === 'gzip' && !precompressed.gzip)
    ) {
      continue;
    }

    const extension = encoding === 'br' ? '.br' : encoding === 'gzip' ? '.gz' : '';
    const candidate = `${logicalPath}${extension}`;
    const opened = await openContainedAsset(root, candidate);

    if (opened) {
      return {
        ...opened,
        representation: extension === ''
          ? { path: candidate }
          : { encoding: encoding === 'identity' ? undefined : encoding, path: candidate },
        variesByEncoding: await hasPrecompressedRepresentation(root, logicalPath, precompressed),
      };
    }
  }

  return undefined;
}

async function hasExistingRepresentation(
  root: ResolvedRoot,
  logicalPath: string,
  precompressed: ResolvedPrecompression,
): Promise<boolean> {
  for (const representation of supportedRepresentations(logicalPath, precompressed)) {
    const opened = await openContainedAsset(root, representation.path);

    if (opened) {
      return true;
    }
  }

  return false;
}

async function hasPrecompressedRepresentation(
  root: ResolvedRoot,
  logicalPath: string,
  precompressed: ResolvedPrecompression,
): Promise<boolean> {
  return await hasExistingRepresentation(root, logicalPath, {
    brotli: precompressed.brotli,
    gzip: precompressed.gzip,
  }) && (
    (precompressed.brotli && await representationExists(root, `${logicalPath}.br`))
    || (precompressed.gzip && await representationExists(root, `${logicalPath}.gz`))
  );
}

function supportedRepresentations(
  logicalPath: string,
  precompressed: ResolvedPrecompression,
): readonly SelectedRepresentation[] {
  return [
    ...(precompressed.brotli ? [{ encoding: 'br' as const, path: `${logicalPath}.br` }] : []),
    ...(precompressed.gzip ? [{ encoding: 'gzip' as const, path: `${logicalPath}.gz` }] : []),
    { path: logicalPath },
  ];
}

async function representationExists(root: ResolvedRoot, logicalPath: string): Promise<boolean> {
  const opened = await openContainedAsset(root, logicalPath);

  return opened !== undefined;
}

async function openContainedAsset(root: ResolvedRoot, path: string): Promise<OpenedAsset | undefined> {
  try {
    const resolvedPath = await realpath(resolve(root.path, path));

    if (!isWithinRoot(root.path, resolvedPath)) {
      return undefined;
    }

    const expected = await stat(resolvedPath, { bigint: true });

    if (!expected.isFile()) {
      return undefined;
    }

    const handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      const metadata = await readAssetMetadata(handle);
      if (
        !metadata
        || metadata.device !== expected.dev
        || metadata.inode !== expected.ino
      ) {
        return undefined;
      }

      const bytes = new Uint8Array(await handle.readFile());
      return {
        bytes,
        metadata: {
          ...metadata,
          size: bytes.byteLength,
        },
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readAssetMetadata(handle: FileHandle): Promise<AssetMetadata | undefined> {
  const metadata = await handle.stat({ bigint: true });

  if (!metadata.isFile() || metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }

  return {
    device: metadata.dev,
    inode: metadata.ino,
    lastModified: new Date(Number(metadata.mtimeMs)),
    size: Number(metadata.size),
  };
}

function createSnapshotStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function createAssetEtag(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url');
}

function isWithinRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'ELOOP' || error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
