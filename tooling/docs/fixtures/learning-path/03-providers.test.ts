import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { PostsModule } from './03-providers/posts.module';
import { expectHealthAndReady, SEED_POST } from './test-support';

/**
 * Checkpoint 03: PostsService owns the seed and the controller receives it
 * through constructor injection, answering the same GET /posts response.
 */

@Module({ imports: [HealthModule.forRoot(), PostsModule] })
class Stage03RootModule {}

describe('learning-path checkpoint 03 — providers', () => {
  it('answers GET /posts from the injected PostsService', async () => {
    const app = await Test.createApp({ rootModule: Stage03RootModule });
    try {
      const response = await app.request('GET', '/posts').send();
      expect(response.status).toBe(200);
      expect(response.body).toEqual([SEED_POST]);
    } finally {
      await app.close();
    }
  });

  it('keeps /health and /ready available', async () => {
    const app = await Test.createApp({ rootModule: Stage03RootModule });
    try {
      await expectHealthAndReady(app);
    } finally {
      await app.close();
    }
  });
});
