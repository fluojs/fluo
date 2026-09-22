import { Module } from '@fluojs/core';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory, HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { PostsModule } from './06-errors/posts.module';
import { expectHealthAndReady, SEED_POST } from './test-support';

/**
 * Checkpoint 06: GET /posts/:id binds FromPath and maps unknown ids to the
 * canonical NotFoundException envelope while list/create behavior is retained.
 *
 * The final suite boots the same checkpoint through FluoFactory.create with a
 * real Fastify listener on an ephemeral port, exercising an actual HTTP round
 * trip including /health and /ready.
 */

@Module({ imports: [HealthModule.forRoot(), PostsModule] })
class Stage06RootModule {}

describe('learning-path checkpoint 06 — errors', () => {
  it('answers GET /posts/:id for the seed', async () => {
    const app = await Test.createApp({ rootModule: Stage06RootModule });
    try {
      const response = await app.request('GET', '/posts/1').send();
      expect(response.status).toBe(200);
      expect(response.body).toEqual(SEED_POST);
    } finally {
      await app.close();
    }
  });

  it('maps an unknown id to the canonical 404 envelope', async () => {
    const app = await Test.createApp({ rootModule: Stage06RootModule });
    try {
      const response = await app.request('GET', '/posts/999').send();
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
    } finally {
      await app.close();
    }
  });

  it('retains list and create behavior', async () => {
    const app = await Test.createApp({ rootModule: Stage06RootModule });
    try {
      const created = await app
        .request('POST', '/posts')
        .body({ title: 'Second post', content: 'Second content.' })
        .send();
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ id: '2', title: 'Second post', content: 'Second content.' });

      const list = await app.request('GET', '/posts').send();
      expect(list.status).toBe(200);
      expect(list.body).toEqual([
        SEED_POST,
        { id: '2', title: 'Second post', content: 'Second content.' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('keeps /health and /ready available', async () => {
    const app = await Test.createApp({ rootModule: Stage06RootModule });
    try {
      await expectHealthAndReady(app);
    } finally {
      await app.close();
    }
  });
});

describe('learning-path checkpoint 06 — real Fastify listener', () => {
  it('serves posts through FluoFactory.create with a real Fastify socket', async () => {
    const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(Stage06RootModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const listResponse = await fetch(`${target.url}/posts`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual([SEED_POST]);

      const createResponse = await fetch(`${target.url}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Second post', content: 'Second content.' }),
      });
      expect(createResponse.status).toBe(201);
      await expect(createResponse.json()).resolves.toEqual({
        id: '2',
        title: 'Second post',
        content: 'Second content.',
      });

      const missingResponse = await fetch(`${target.url}/posts/999`);
      expect(missingResponse.status).toBe(404);
      await expect(missingResponse.json()).resolves.toMatchObject({
        error: { code: 'NOT_FOUND', status: 404 },
      });

      const healthResponse = await fetch(`${target.url}/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ status: 'ok' });

      const readyResponse = await fetch(`${target.url}/ready`);
      expect(readyResponse.status).toBe(200);
      await expect(readyResponse.json()).resolves.toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });
});
