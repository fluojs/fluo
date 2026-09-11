import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../../tooling/testing/with-cleanup.js';
import { AppModule } from '../src/app';

describe('FluoBlog request pipeline', () => {
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

  it('lists the initial post when no post has been created', async () => {
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

  it('creates a post when its body satisfies the DTO rules', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('POST', '/posts')
        .body({ title: 'Learning Fluo', content: 'Explicit modules and DI.' })
        .send();

      // Then
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: '2',
        title: 'Learning Fluo',
        content: 'Explicit modules and DI.',
      });
    });
  });

  it.each([
    ['the shortest accepted values', { title: 'abc', content: 'x' }],
    ['the longest accepted values', { title: 'a'.repeat(120), content: 'b'.repeat(5000) }],
  ])('accepts a post when it uses %s', async (_label, body) => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('POST', '/posts').body(body).send();

      // Then
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: '2', ...body });
    });
  });

  it.each([
    ['title is omitted', { content: 'Valid content' }, 'title'],
    ['title is null', { title: null, content: 'Valid content' }, 'title'],
    ['title is not a string', { title: 123, content: 'Valid content' }, 'title'],
    ['title is too short', { title: 'ab', content: 'Valid content' }, 'title'],
    ['title is too long', { title: 'a'.repeat(121), content: 'Valid content' }, 'title'],
    ['content is omitted', { title: 'Valid title' }, 'content'],
    ['content is null', { title: 'Valid title', content: null }, 'content'],
    ['content is not a string', { title: 'Valid title', content: 123 }, 'content'],
    ['content is empty', { title: 'Valid title', content: '' }, 'content'],
    ['content is too long', { title: 'Valid title', content: 'a'.repeat(5001) }, 'content'],
  ])('returns field details when %s', async (_label, body, field) => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('POST', '/posts').body(body).send();

      // Then
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'BAD_REQUEST',
          status: 400,
          details: expect.arrayContaining([
            expect.objectContaining({ field, source: 'body', code: expect.any(String) }),
          ]),
        },
      });
    });
  });

  it('preserves the list when validation rejects a request', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      await app.request('POST', '/posts').body({ title: null, content: null }).send();

      // When
      const response = await app.request('GET', '/posts').send();

      // Then
      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
      ]);
    });
  });

  it('retrieves a post when it was created by an earlier request', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      await app.request('POST', '/posts')
        .body({ title: 'Learning Fluo', content: 'Explicit modules and DI.' })
        .send();

      // When
      const response = await app.request('GET', '/posts/2').send();

      // Then
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: '2', title: 'Learning Fluo', content: 'Explicit modules and DI.',
      });
    });
  });

  it('includes a created post when listing subsequent requests', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      await app.request('POST', '/posts')
        .body({ title: 'Learning Fluo', content: 'Explicit modules and DI.' })
        .send();

      // When
      const response = await app.request('GET', '/posts').send();

      // Then
      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
        { id: '2', title: 'Learning Fluo', content: 'Explicit modules and DI.' },
      ]);
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

  it('rejects unbound fields when a client supplies an ID or admin flag', async () => {
    // Given
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When
      const response = await app.request('POST', '/posts')
        .body({ id: '999', title: 'Learning Fluo', content: 'Explicit fields.', admin: true })
        .send();

      // Then
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'BAD_REQUEST',
          status: 400,
          details: expect.arrayContaining([
            expect.objectContaining({ code: 'UNKNOWN_FIELD', field: 'id', source: 'body' }),
            expect.objectContaining({ code: 'UNKNOWN_FIELD', field: 'admin', source: 'body' }),
          ]),
        },
      });
    });
  });

  it('starts with seed data when a new application is created', async () => {
    // Given
    const first = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => first.close());
      await first.request('POST', '/posts')
        .body({ title: 'First application', content: 'Not persisted.' })
        .send();
    });
    const second = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => second.close());
      // When
      const response = await second.request('GET', '/posts').send();

      // Then
      expect(response.body).toEqual([
        { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
      ]);
    });
  });
});
