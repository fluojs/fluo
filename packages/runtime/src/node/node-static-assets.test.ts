import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeFileSystemAssetSource } from '../node.js';

const temporaryDirectories: string[] = [];

async function createAssetDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-static-assets-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function readBytes(source: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function requireStaticAsset(asset: Awaited<ReturnType<ReturnType<typeof createNodeFileSystemAssetSource>['resolve']>>) {
  if (!asset || 'notAcceptable' in asset) {
    throw new Error('Expected a static asset representation.');
  }

  return asset;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

describe('Node filesystem static asset source', () => {
  it('rejects invalid roots during configuration', async () => {
    const root = await createAssetDirectory();

    expect(() => createNodeFileSystemAssetSource({ root: '' })).toThrow('root');
    expect(() => createNodeFileSystemAssetSource({ root: join(root, 'missing') })).toThrow('directory');
  });

  it('serves only real files below its root and selects precompressed representations', async () => {
    const root = await createAssetDirectory();
    const outside = await createAssetDirectory();
    await writeFile(join(root, 'app.js'), Uint8Array.from([0, 1, 2, 3]));
    await writeFile(join(root, 'app.js.br'), Uint8Array.from([4, 5, 6]));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'linked-secret.txt'));
    const source = createNodeFileSystemAssetSource({
      precompressed: { brotli: true },
      root,
    });

    const compressed = await source.resolve('app.js', {
      acceptedEncodings: ['br', 'identity', 'gzip'],
    });
    const traversed = await source.resolve('../secret.txt', {
      acceptedEncodings: ['identity'],
    });
    const symlinked = await source.resolve('linked-secret.txt', {
      acceptedEncodings: ['identity'],
    });

    const selected = requireStaticAsset(compressed);

    expect(selected).toMatchObject({
      contentEncoding: 'br',
      contentType: 'application/javascript',
      size: 3,
      variesByEncoding: true,
    });
    expect(selected.validators?.etag).toMatchObject({ strength: 'strong' });
    expect(traversed).toBeUndefined();
    expect(symlinked).toBeUndefined();

    if (typeof selected.source !== 'function') {
      throw new Error('Expected a lazy static asset stream source.');
    }

    await expect(readBytes(selected.source())).resolves.toEqual(Uint8Array.from([4, 5, 6]));
  });

  it('retains the opened file when the resolved pathname is replaced', async () => {
    const root = await createAssetDirectory();
    const outside = await createAssetDirectory();
    await writeFile(join(root, 'app.js'), Uint8Array.from([1, 2, 3]));
    await writeFile(join(outside, 'secret.js'), Uint8Array.from([9, 9, 9, 9]));
    const source = createNodeFileSystemAssetSource({ root });

    const asset = await source.resolve('app.js', {
      acceptedEncodings: ['identity'],
    });

    await rm(join(root, 'app.js'));
    await symlink(join(outside, 'secret.js'), join(root, 'app.js'));

    const selected = requireStaticAsset(asset);

    expect(selected).toMatchObject({ size: 3 });

    if (typeof selected.source !== 'function') {
      throw new Error('Expected a handle-owned static asset stream source.');
    }

    await expect(readBytes(selected.source())).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    await selected.dispose?.();
  });

  it('changes the ETag when a same-size file is replaced without a second boundary', async () => {
    const root = await createAssetDirectory();
    await writeFile(join(root, 'app.js'), Uint8Array.from([1, 2, 3]));
    const source = createNodeFileSystemAssetSource({ root });
    const original = requireStaticAsset(await source.resolve('app.js', {
      acceptedEncodings: ['identity'],
    }));

    await rm(join(root, 'app.js'));
    await writeFile(join(root, 'app.js'), Uint8Array.from([4, 5, 6]));
    const replacement = requireStaticAsset(await source.resolve('app.js', {
      acceptedEncodings: ['identity'],
    }));

    expect(replacement.validators?.etag?.opaqueValue).not.toBe(original.validators?.etag?.opaqueValue);

    await Promise.all([original.dispose?.(), replacement.dispose?.()]);
  });

  it('selects accepted representations and reports an existing unacceptable asset', async () => {
    const root = await createAssetDirectory();
    await writeFile(join(root, 'app.js'), Uint8Array.from([1]));
    await writeFile(join(root, 'app.js.br'), Uint8Array.from([2]));
    await writeFile(join(root, 'app.js.gz'), Uint8Array.from([3]));
    const source = createNodeFileSystemAssetSource({
      precompressed: true,
      root,
    });

    const brotli = await source.resolve('app.js', {
      acceptedEncodings: ['br', 'gzip', 'identity'],
    });
    const gzip = await source.resolve('app.js', {
      acceptedEncodings: ['gzip', 'identity'],
    });
    const identity = await source.resolve('app.js', {
      acceptedEncodings: ['identity'],
    });
    const none = await source.resolve('app.js', {
      acceptedEncodings: [],
    });

    expect(brotli).toMatchObject({ contentEncoding: 'br', variesByEncoding: true });
    expect(gzip).toMatchObject({ contentEncoding: 'gzip', variesByEncoding: true });
    expect(identity).toMatchObject({ contentEncoding: undefined, variesByEncoding: true });
    expect(none).toEqual({ notAcceptable: true });

    await Promise.all([brotli, gzip, identity].map(async (asset) => {
      if (asset && !('notAcceptable' in asset)) {
        await asset.dispose?.();
      }
    }));
  });
});
