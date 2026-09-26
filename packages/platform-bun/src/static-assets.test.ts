import { mkdir, mkdtemp, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBunFileSystemAssetSource } from './index.js';

const fileProbe = vi.hoisted(() => ({
  onOpen: undefined as undefined | ((path: string) => Promise<void>),
  opened: 0,
  closed: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>) {
      await fileProbe.onOpen?.(String(args[0]));
      const handle = await actual.open(...args);
      fileProbe.opened += 1;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        fileProbe.closed += 1;
      };
      return handle;
    },
  };
});

const directories: string[] = [];

async function assetRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fluo-bun-assets-'));
  directories.push(root);
  return root;
}

async function selected(source: ReturnType<typeof createBunFileSystemAssetSource>, path: string, acceptedEncodings: ('br' | 'gzip' | 'identity')[] = ['identity']) {
  const asset = await source.resolve(path, { acceptedEncodings });
  if (!asset || 'notAcceptable' in asset) {
    throw new Error('Expected an asset.');
  }
  return asset;
}

async function bytes(asset: Awaited<ReturnType<typeof selected>>): Promise<Uint8Array> {
  if (asset.source instanceof Uint8Array) {
    return asset.source;
  }
  throw new Error('Expected snapshotted bytes.');
}

afterEach(async () => {
  fileProbe.onOpen = undefined;
  expect(fileProbe.closed).toBe(fileProbe.opened);
  fileProbe.opened = 0;
  fileProbe.closed = 0;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Bun filesystem static asset source', () => {
  it('rejects missing roots and files as asset directories', async () => {
    const root = await assetRoot();
    await writeFile(join(root, 'file.txt'), 'hello');

    expect(() => createBunFileSystemAssetSource({ root: '' })).toThrow('root');
    expect(() => createBunFileSystemAssetSource({ root: join(root, 'missing') })).toThrow('directory');
    expect(() => createBunFileSystemAssetSource({ root: join(root, 'file.txt') })).toThrow('directory');
  });

  it('snapshots nested files and MIME types while missing paths fall through', async () => {
    const root = await assetRoot();
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'style.css'), Uint8Array.of(0, 1, 2));
    await writeFile(join(root, 'app.js'), 'const app = true;');
    await writeFile(join(root, 'favicon.ico'), Uint8Array.of(3, 4));
    const source = createBunFileSystemAssetSource({ root });

    expect(await selected(source, 'assets/style.css')).toMatchObject({
      contentType: 'text/css; charset=utf-8',
      size: 3,
    });
    expect(await bytes(await selected(source, 'assets/style.css'))).toEqual(Uint8Array.of(0, 1, 2));
    expect((await selected(source, 'app.js')).contentType).toBe('application/javascript');
    expect((await selected(source, 'favicon.ico')).contentType).toBe('image/x-icon');
    await expect(source.resolve('missing.js', { acceptedEncodings: ['identity'] })).resolves.toBeUndefined();
  });

  it('rejects traversal, absolute paths and escaping symlinks', async () => {
    const root = await assetRoot();
    const outside = await assetRoot();
    await writeFile(join(outside, 'secret.js'), 'secret');
    await symlink(join(outside, 'secret.js'), join(root, 'linked.js'));
    const source = createBunFileSystemAssetSource({ root });

    for (const path of ['../secret.js', '/secret.js', 'x/../secret.js', 'x\\secret.js', 'linked.js']) {
      await expect(source.resolve(path, { acceptedEncodings: ['identity'] })).resolves.toBeUndefined();
    }
  });

  it('does not open a replaced intermediate directory outside the root', async () => {
    const root = await assetRoot();
    const outside = await assetRoot();
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'app.js'), 'inside');
    await writeFile(join(outside, 'app.js'), 'outside');
    fileProbe.onOpen = async (path) => {
      fileProbe.onOpen = undefined;
      if (path.endsWith('/assets/app.js')) {
        await rename(join(root, 'assets'), join(root, 'original'));
        await symlink(outside, join(root, 'assets'));
      }
    };

    await expect(createBunFileSystemAssetSource({ root }).resolve('assets/app.js', {
      acceptedEncodings: ['identity'],
    })).resolves.toBeUndefined();
  });

  it('does not follow a leaf replaced by an outside symlink during resolution', async () => {
    const root = await assetRoot();
    const outside = await assetRoot();
    await writeFile(join(root, 'app.js'), 'inside');
    await writeFile(join(outside, 'secret.js'), 'outside');
    fileProbe.onOpen = async () => {
      fileProbe.onOpen = undefined;
      await rm(join(root, 'app.js'));
      await symlink(join(outside, 'secret.js'), join(root, 'app.js'));
    };

    await expect(createBunFileSystemAssetSource({ root }).resolve('app.js', {
      acceptedEncodings: ['identity'],
    })).resolves.toBeUndefined();
  });

  it('keeps bytes and validators coherent after the pathname is replaced or rewritten', async () => {
    const root = await assetRoot();
    const path = join(root, 'app.js');
    await writeFile(path, Uint8Array.of(1, 2, 3));
    const source = createBunFileSystemAssetSource({ root });
    const original = await selected(source, 'app.js');
    const previous = await stat(path);

    await writeFile(path, Uint8Array.of(4, 5, 6));
    await utimes(path, previous.atime, previous.mtime);
    const rewritten = await selected(source, 'app.js');
    await rm(path);
    await writeFile(path, Uint8Array.of(7, 8, 9));

    expect(await bytes(original)).toEqual(Uint8Array.of(1, 2, 3));
    expect(await bytes(rewritten)).toEqual(Uint8Array.of(4, 5, 6));
    expect(rewritten.validators?.etag?.opaqueValue).not.toBe(original.validators?.etag?.opaqueValue);
    expect(rewritten.size).toBe(3);
  });

  it('negotiates precompressed siblings and reports unacceptable existing assets', async () => {
    const root = await assetRoot();
    await writeFile(join(root, 'app.js'), Uint8Array.of(1));
    await writeFile(join(root, 'app.js.br'), Uint8Array.of(2, 3));
    await writeFile(join(root, 'app.js.gz'), Uint8Array.of(4));
    const source = createBunFileSystemAssetSource({ root, precompressed: true });

    expect(await selected(source, 'app.js', ['br', 'gzip', 'identity'])).toMatchObject({
      contentEncoding: 'br', size: 2, variesByEncoding: true,
    });
    expect(await selected(source, 'app.js', ['gzip', 'identity'])).toMatchObject({
      contentEncoding: 'gzip', size: 1, variesByEncoding: true,
    });
    expect(await selected(source, 'app.js')).toMatchObject({
      contentEncoding: undefined, variesByEncoding: true,
    });
    await expect(source.resolve('app.js', { acceptedEncodings: [] })).resolves.toEqual({ notAcceptable: true });
  });
});
