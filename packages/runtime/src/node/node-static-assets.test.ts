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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

describe('Node filesystem static asset source', () => {
  it('rejects invalid roots during configuration', () => {
    expect(() => createNodeFileSystemAssetSource({ root: '' })).toThrow('root');
    expect(() => createNodeFileSystemAssetSource({ root: join(tmpdir(), 'missing-static-assets-root') })).toThrow('directory');
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
      acceptedEncodings: ['br'],
    });
    const traversed = await source.resolve('../secret.txt', {
      acceptedEncodings: [],
    });
    const symlinked = await source.resolve('linked-secret.txt', {
      acceptedEncodings: [],
    });

    expect(compressed).toMatchObject({
      contentEncoding: 'br',
      contentType: 'application/javascript',
      size: 3,
      variesByEncoding: true,
    });
    expect(compressed?.validators?.etag).toMatchObject({ strength: 'weak' });
    expect(traversed).toBeUndefined();
    expect(symlinked).toBeUndefined();

    if (!compressed || typeof compressed.source !== 'function') {
      throw new Error('Expected a lazy static asset stream source.');
    }

    await expect(readBytes(compressed.source())).resolves.toEqual(Uint8Array.from([4, 5, 6]));
  });
});
