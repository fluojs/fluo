import { constants, realpathSync, statSync } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

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
        dispose: selected.dispose,
        source: () => Readable.toWeb(selected.handle.createReadStream({ autoClose: false })) as ReadableStream<Uint8Array>,
        size: selected.metadata.size,
        validators: {
          etag: {
            opaqueValue: createAssetEtag(selected.metadata),
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

type SelectedRepresentation = {
  readonly encoding?: StaticAssetContentEncoding;
  readonly path: string;
};

type OpenedAsset = {
  readonly dispose: () => Promise<void>;
  readonly handle: FileHandle;
  readonly metadata: AssetMetadata;
};

type AssetMetadata = {
  readonly device: bigint;
  readonly inode: bigint;
  readonly lastModified: Date;
  readonly lastModifiedNanoseconds: bigint;
  readonly size: number;
};

type SelectedOpenedRepresentation = {
  readonly dispose: () => Promise<void>;
  readonly handle: FileHandle;
  readonly metadata: AssetMetadata;
  readonly representation: SelectedRepresentation;
  readonly variesByEncoding: boolean;
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
  root: string,
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
  root: string,
  logicalPath: string,
  precompressed: ResolvedPrecompression,
): Promise<boolean> {
  for (const representation of supportedRepresentations(logicalPath, precompressed)) {
    const opened = await openContainedAsset(root, representation.path);

    if (opened) {
      await opened.dispose();
      return true;
    }
  }

  return false;
}

async function hasPrecompressedRepresentation(
  root: string,
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

async function representationExists(root: string, logicalPath: string): Promise<boolean> {
  const opened = await openContainedAsset(root, logicalPath);

  if (!opened) {
    return false;
  }

  await opened.dispose();
  return true;
}

async function openContainedAsset(root: string, path: string): Promise<OpenedAsset | undefined> {
  try {
    const resolvedPath = await realpath(path);

    if (!isWithinRoot(root, resolvedPath)) {
      return undefined;
    }

    const handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const dispose = createHandleDisposer(handle);

    try {
      const metadata = await readAssetMetadata(handle);

      if (!metadata) {
        await dispose();
        return undefined;
      }

      return { dispose, handle, metadata };
    } catch (error) {
      await dispose();
      throw error;
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
    lastModifiedNanoseconds: metadata.mtimeNs,
    size: Number(metadata.size),
  };
}

function createAssetEtag(metadata: AssetMetadata): string {
  return [
    metadata.device,
    metadata.inode,
    BigInt(metadata.size),
    metadata.lastModifiedNanoseconds,
  ].map((value) => value.toString(16)).join('-');
}

function createHandleDisposer(handle: FileHandle): () => Promise<void> {
  let closing: Promise<void> | undefined;

  return () => {
    closing ??= handle.close();
    return closing;
  };
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
