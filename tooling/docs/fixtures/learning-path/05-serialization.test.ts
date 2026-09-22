import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { PostsModule } from './05-serialization/posts.module';
import { expectHealthAndReady, SEED_POST } from './test-support';

/**
 * Checkpoint 05: handlers return explicit PostResponseDto instances and the
 * SerializerInterceptor strips the unexposed internalNotes field on both GET
 * and POST responses.
 */

@Module({ imports: [HealthModule.forRoot(), PostsModule] })
class Stage05RootModule {}

describe('learning-path checkpoint 05 — serialization', () => {
  it('never exposes internalNotes on GET /posts', async () => {
    const app = await Test.createApp({ rootModule: Stage05RootModule });
    try {
      const response = await app.request('GET', '/posts').send();
      expect(response.status).toBe(200);
      expect(response.body).toEqual([SEED_POST]);
    } finally {
      await app.close();
    }
  });

  it('never exposes internalNotes on POST /posts', async () => {
    const app = await Test.createApp({ rootModule: Stage05RootModule });
    try {
      const response = await app
        .request('POST', '/posts')
        .body({ title: 'Second post', content: 'Second content.' })
        .send();
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: '2', title: 'Second post', content: 'Second content.' });
    } finally {
      await app.close();
    }
  });

  it('keeps /health and /ready available', async () => {
    const app = await Test.createApp({ rootModule: Stage05RootModule });
    try {
      await expectHealthAndReady(app);
    } finally {
      await app.close();
    }
  });
});
