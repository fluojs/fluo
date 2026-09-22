import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { PostsModule } from './01-modules/posts.module';
import { expectHealthAndReady } from './test-support';

/**
 * Checkpoint 01: the generated root module imports the empty PostsModule and
 * HealthModule.forRoot(); /health and /ready stay available.
 */

@Module({ imports: [HealthModule.forRoot(), PostsModule] })
class Stage01RootModule {}

describe('learning-path checkpoint 01 — modules', () => {
  it('keeps /health and /ready available with an empty PostsModule', async () => {
    const app = await Test.createApp({ rootModule: Stage01RootModule });
    try {
      await expectHealthAndReady(app);
    } finally {
      await app.close();
    }
  });

  it('registers no /posts routes yet', async () => {
    const app = await Test.createApp({ rootModule: Stage01RootModule });
    try {
      const response = await app.request('GET', '/posts').send();
      expect(response.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
