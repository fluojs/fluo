import { NextHttpApplicationAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { AppModule, SEED_POST } from './posts-app';

/**
 * Package-guide fixture for @fluojs/platform-nextjs
 * (apps/docs/content/docs/packages/platform-nextjs.mdx).
 *
 * Drives the adapter's real dispatch surface — instance `fetch(request)` —
 * with the real FluoFactory bootstrap, exactly the surface Next Route
 * Handlers call. These tests do NOT exercise Next.js routing, compilation, or
 * bundling; that boundary is covered by the package's own production E2E
 * (packages/platform-nextjs/e2e/next.test.mjs). Apps close in finally; there
 * are no sleeps.
 */

describe('docs packages node-platforms — Next adapter dispatch', () => {
  it('dispatches Web requests through the shared pipeline without owning a socket', async () => {
    const adapter = NextHttpApplicationAdapter.create();
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();

      const health = await adapter.fetch(new Request('http://fluo.test/health'));
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: 'ok' });

      const list = await adapter.fetch(new Request('http://fluo.test/posts'));
      expect(list.status).toBe(200);
      await expect(list.json()).resolves.toEqual([SEED_POST]);

      const create = await adapter.fetch(
        new Request('http://fluo.test/posts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'From the Next facade',
            content: 'Dispatched via instance fetch().',
          }),
        }),
      );
      expect(create.status).toBe(201);
      await expect(create.json()).resolves.toEqual({
        id: '2',
        title: 'From the Next facade',
        content: 'Dispatched via instance fetch().',
      });

      const missing = await adapter.fetch(new Request('http://fluo.test/definitely-not-a-route'));
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', status: 404 },
      });
    } finally {
      await app.close();
    }
  });

  it('answers problem+json before the dispatcher is bound', async () => {
    const adapter = NextHttpApplicationAdapter.create();

    const response = await adapter.fetch(new Request('http://fluo.test/health'));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({
      code: 'next_backend_adapter_not_ready',
      status: 503,
    });
  });

  it('serves bodyless opt-in HEAD and returns problem+json after close', async () => {
    const adapter = NextHttpApplicationAdapter.create({ headRouting: 'explicit-or-get' });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();

      const head = await adapter.fetch(new Request('http://fluo.test/health', { method: 'HEAD' }));
      expect(head.status).toBe(200);
      await expect(head.text()).resolves.toBe('');

      const get = await adapter.fetch(new Request('http://fluo.test/health'));
      expect(get.status).toBe(200);
      await expect(get.json()).resolves.toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }

    // After close the same adapter answers 503 problem+json; the opted-in HEAD
    // response stays bodyless even for the shutdown state.
    const closedHead = await adapter.fetch(
      new Request('http://fluo.test/health', { method: 'HEAD' }),
    );
    expect(closedHead.status).toBe(503);
    expect(closedHead.body).toBeNull();

    const closedGet = await adapter.fetch(new Request('http://fluo.test/health'));
    expect(closedGet.status).toBe(503);
    expect(closedGet.headers.get('content-type')).toBe('application/problem+json');
    await expect(closedGet.json()).resolves.toMatchObject({
      code: 'next_backend_adapter_closed',
      status: 503,
    });
  });
});
