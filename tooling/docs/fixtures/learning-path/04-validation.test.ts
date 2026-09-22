import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { PostsModule } from './04-validation/posts.module';
import { expectHealthAndReady, SEED_POST } from './test-support';

/**
 * Checkpoint 04: POST /posts validates CreatePostDto and answers 201 with
 * sequential ids; invalid bodies map to the canonical 400 envelope.
 */

@Module({ imports: [HealthModule.forRoot(), PostsModule] })
class Stage04RootModule {}

describe('learning-path checkpoint 04 — validation', () => {
  it('creates posts with sequential ids and answers 201', async () => {
    const app = await Test.createApp({ rootModule: Stage04RootModule });
    try {
      const first = await app
        .request('POST', '/posts')
        .body({ title: 'Second post', content: 'Second content.' })
        .send();
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ id: '2', title: 'Second post', content: 'Second content.' });

      const second = await app
        .request('POST', '/posts')
        .body({ title: 'Third post', content: 'Third content.' })
        .send();
      expect(second.status).toBe(201);
      expect(second.body).toEqual({ id: '3', title: 'Third post', content: 'Third content.' });
    } finally {
      await app.close();
    }
  });

  it('rejects a title below MinLength(3) with 400', async () => {
    const app = await Test.createApp({ rootModule: Stage04RootModule });
    try {
      const response = await app
        .request('POST', '/posts')
        .body({ title: 'ab', content: 'Valid content.' })
        .send();
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST', status: 400 } });
    } finally {
      await app.close();
    }
  });

  it('rejects empty content with 400', async () => {
    const app = await Test.createApp({ rootModule: Stage04RootModule });
    try {
      const response = await app
        .request('POST', '/posts')
        .body({ title: 'Valid title', content: '' })
        .send();
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST', status: 400 } });
    } finally {
      await app.close();
    }
  });

  it('keeps GET /posts reflecting created posts', async () => {
    const app = await Test.createApp({ rootModule: Stage04RootModule });
    try {
      await app.request('POST', '/posts').body({ title: 'Second post', content: 'Second content.' }).send();

      const response = await app.request('GET', '/posts').send();
      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        SEED_POST,
        { id: '2', title: 'Second post', content: 'Second content.' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('keeps /health and /ready available', async () => {
    const app = await Test.createApp({ rootModule: Stage04RootModule });
    try {
      await expectHealthAndReady(app);
    } finally {
      await app.close();
    }
  });
});
