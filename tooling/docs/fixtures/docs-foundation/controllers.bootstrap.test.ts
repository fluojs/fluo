import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { AppModule } from './posts-app';

/**
 * Bootstrap fixture for the "Controllers" documentation page
 * (apps/docs/content/docs/overview/controllers.mdx).
 *
 * It executes the page's main.ts shape end to end: FluoFactory.create with a
 * Fastify adapter, a real listening socket, an HTTP request over that socket,
 * and an orderly close. The port is 0 so the OS assigns a free port; the
 * adapter's documented getListenTarget() reports the resulting URL after
 * listen().
 */

describe('docs-foundation controllers bootstrap fixture', () => {
  it('serves the application through FluoFactory.create and a Fastify listener', async () => {
    const adapter = FastifyHttpApplicationAdapter.create({
      host: '127.0.0.1',
      port: 0,
    });

    const app = await FluoFactory.create(AppModule, {
      adapter,
      logger: createConsoleApplicationLogger(),
      shutdownRegistration: createNodeShutdownSignalRegistration(),
    });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const postsResponse = await fetch(`${target.url}/posts`);
      expect(postsResponse.status).toBe(200);
      await expect(postsResponse.json()).resolves.toEqual([
        { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
      ]);

      const healthResponse = await fetch(`${target.url}/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
