import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { AppModule, type RawEcho, SEED_POST, type UploadEcho } from './posts-app';

/**
 * Package-guide fixture for @fluojs/platform-fastify
 * (apps/docs/content/docs/packages/platform-fastify.mdx).
 *
 * Exercises the Fastify adapter over a real listener on an OS-assigned port:
 * the shared dispatcher round trip, opt-in rawBody byte replay, and buffered
 * multipart materialization into the runtime-neutral files seam. Apps close in
 * finally; there are no sleeps.
 */

describe('docs packages node-platforms — Fastify adapter', () => {
  it('serves the posts application over a real Fastify listener', async () => {
    const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
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
        body: JSON.stringify({ title: 'Fastify', content: 'Created on the Fastify listener.' }),
      });
      expect(create.status).toBe(201);
      await expect(create.json()).resolves.toEqual({
        id: '2',
        title: 'Fastify',
        content: 'Created on the Fastify listener.',
      });

      const health = await fetch(`${target.url}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: 'ok' });

      const missing = await fetch(`${target.url}/definitely-not-a-route`);
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', status: 404 },
      });
    } finally {
      await app.close();
    }
  });

  it('replays opt-in rawBody bytes byte-exactly', async () => {
    const adapter = FastifyHttpApplicationAdapter.create({
      host: '127.0.0.1',
      port: 0,
      rawBody: true,
    });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const payload = JSON.stringify({ note: 'Hello, raw body! 🌍' });
      const response = await fetch(`${target.url}/posts/raw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      // fluo POST routes answer 201 by default; @HttpCode can override.
      expect(response.status).toBe(201);

      const body: RawEcho = await response.json();
      expect(body.text).toBe(payload);
      expect(body.byteLength).toBe(new TextEncoder().encode(payload).byteLength);
    } finally {
      await app.close();
    }
  });

  it('materializes buffered multipart uploads into the portable files seam', async () => {
    const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const form = new FormData();
      form.append('file', new Blob(['hello upload'], { type: 'text/plain' }), 'upload.txt');

      const response = await fetch(`${target.url}/posts/upload`, { method: 'POST', body: form });
      expect(response.status).toBe(201);

      const body: UploadEcho = await response.json();
      expect(body).toEqual({ mimetype: 'text/plain', name: 'upload.txt', size: 12 });
    } finally {
      await app.close();
    }
  });
});
