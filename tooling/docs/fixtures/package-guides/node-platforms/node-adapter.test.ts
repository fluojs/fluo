import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { createStaticAssetsMiddleware } from '@fluojs/http';
import {
  createNodeFileSystemAssetSource,
  NodeHttpApplicationAdapter,
} from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { AppModule, SEED_POST } from './posts-app';

/**
 * Package-guide fixture for @fluojs/platform-nodejs
 * (apps/docs/content/docs/packages/platform-nodejs.mdx).
 *
 * Exercises the raw Node adapter over a real listener on an OS-assigned port
 * plus the filesystem static-asset source composed through the shared
 * @fluojs/http middleware. Apps close in finally; there are no sleeps.
 */

describe('docs packages node-platforms — raw Node adapter', () => {
  it('serves the posts application over a real Node listener', async () => {
    const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();
      expect(target.url.startsWith('http://127.0.0.1:')).toBe(true);

      const list = await fetch(`${target.url}/posts`);
      expect(list.status).toBe(200);
      await expect(list.json()).resolves.toEqual([SEED_POST]);

      const create = await fetch(`${target.url}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Raw Node', content: 'Created on the built-in server.' }),
      });
      expect(create.status).toBe(201);
      await expect(create.json()).resolves.toEqual({
        id: '2',
        title: 'Raw Node',
        content: 'Created on the built-in server.',
      });

      const health = await fetch(`${target.url}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('propagates the client request id into dispatcher error envelopes', async () => {
    const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const missing = await fetch(`${target.url}/definitely-not-a-route`, {
        headers: { 'x-request-id': 'node-fixture-rid' },
      });
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', status: 404, requestId: 'node-fixture-rid' },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects conflicting HTTP/HTTPS construction options before creating a server', () => {
    expect(() =>
      NodeHttpApplicationAdapter.create({ http: {}, https: {} }),
    ).toThrowError(/Plain HTTP and HTTPS server options cannot be used together/);

    expect(() => NodeHttpApplicationAdapter.create({ port: 70_000 })).toThrowError(/Invalid PORT/);
  });
});

describe('docs packages node-platforms — Node static asset source composition', () => {
  it('serves identity and precompressed representations and falls through misses to fluo', async () => {
    const assetsRoot = mkdtempSync(join(tmpdir(), 'fluo-node-assets-'));
    const assetText = 'console.log("fluo static");\n';

    try {
      writeFileSync(join(assetsRoot, 'app.js'), assetText);
      writeFileSync(join(assetsRoot, 'app.js.gz'), gzipSync(Buffer.from(assetText, 'utf8')));

      const assets = createStaticAssetsMiddleware({
        cacheControl: 'public, max-age=3600',
        prefix: '/assets',
        source: createNodeFileSystemAssetSource({ precompressed: true, root: assetsRoot }),
      });

      const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
      const app = await FluoFactory.create(AppModule, { adapter, middleware: [assets] });

      try {
        await app.listen();
        const target = adapter.getListenTarget();

        const identity = await fetch(`${target.url}/assets/app.js`, {
          headers: { 'accept-encoding': 'identity' },
        });
        expect(identity.status).toBe(200);
        expect(identity.headers.get('content-type')).toBe('application/javascript');
        expect(identity.headers.get('cache-control')).toBe('public, max-age=3600, no-transform');
        await expect(identity.text()).resolves.toBe(assetText);

        const compressed = await fetch(`${target.url}/assets/app.js`, {
          headers: { 'accept-encoding': 'gzip' },
        });
        expect(compressed.status).toBe(200);
        expect(compressed.headers.get('content-encoding')).toBe('gzip');
        expect(compressed.headers.get('vary')).toContain('Accept-Encoding');
        await expect(compressed.text()).resolves.toBe(assetText);

        const missing = await fetch(`${target.url}/assets/missing.js`, {
          headers: { 'accept-encoding': 'identity' },
        });
        expect(missing.status).toBe(404);
        await expect(missing.json()).resolves.toMatchObject({
          error: { code: 'NOT_FOUND', status: 404 },
        });
      } finally {
        await app.close();
      }
    } finally {
      rmSync(assetsRoot, { recursive: true, force: true });
    }
  });
});
