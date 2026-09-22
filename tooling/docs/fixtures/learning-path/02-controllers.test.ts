import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { PostsModule } from './02-controllers/posts.module';
import { expectHealthAndReady, SEED_POST } from './test-support';

/**
 * Checkpoint 02: PostsController answers GET /posts with the static seed.
 */

@Module({ imports: [HealthModule.forRoot(), PostsModule] })
class Stage02RootModule {}

describe('learning-path checkpoint 02 — controllers', () => {
  it('answers GET /posts with the static seed', async () => {
    const app = await Test.createApp({ rootModule: Stage02RootModule });
    try {
      const response = await app.request('GET', '/posts').send();
      expect(response.status).toBe(200);
      expect(response.body).toEqual([SEED_POST]);
    } finally {
      await app.close();
    }
  });

  it('keeps /health and /ready available', async () => {
    const app = await Test.createApp({ rootModule: Stage02RootModule });
    try {
      await expectHealthAndReady(app);
    } finally {
      await app.close();
    }
  });
});
