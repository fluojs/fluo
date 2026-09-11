import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../../tooling/testing/with-cleanup.js';
import { AppModule } from '../src/app';

describe('FluoBlog module and DI checkpoint', () => {
  it.each([
    ['/health', 'ok'],
    ['/ready', 'ready'],
  ])('preserves the starter endpoint when %s is requested', async (path, status) => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('GET', path).send();

      // Then
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status });
    });
  });

  it('preserves the list when the controller delegates to its provider', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('GET', '/posts').send();

      // Then
      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
      ]);
    });
  });

  it('finds a post when its ID is bound from the path', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('GET', '/posts/1').send();

      // Then
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: '1', title: 'Hello, Fluo!', content: 'My first post.',
      });
    });
  });

  it('returns a resource error when the post ID is unknown', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('GET', '/posts/999').send();

      // Then
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: { code: 'NOT_FOUND', status: 404 },
      });
    });
  });
});
