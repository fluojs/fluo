import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from './posts-app';

/**
 * Request-level fixture for the "Controllers" documentation page
 * (apps/docs/content/docs/overview/controllers.mdx).
 *
 * It boots the page's runnable application through Test.createApp and asserts
 * machine-observable behavior only: statuses, JSON bodies, and canonical
 * error codes. The listening-server lifecycle is exercised separately in
 * controllers.bootstrap.test.ts.
 */

describe('docs-foundation controllers fixture', () => {
  it('answers GET /posts with the stored list', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app.request('GET', '/posts').send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('binds the path parameter for GET /posts/:id', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app.request('GET', '/posts/1').send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: '1',
        title: 'Hello, Fluo!',
        content: 'My first post.',
      });
    } finally {
      await app.close();
    }
  });

  it('maps a thrown NotFoundException to the canonical 404 envelope', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app.request('GET', '/posts/999').send();

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: { code: 'NOT_FOUND', status: 404 },
      });
    } finally {
      await app.close();
    }
  });

  it('binds the body for POST /posts', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app
        .request('POST', '/posts')
        .body({ title: 'Second post', content: 'Bound from the body.' })
        .send();

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: '2',
        title: 'Second post',
        content: 'Bound from the body.',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects a body that fails DTO validation with 400', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app
        .request('POST', '/posts')
        .body({ title: 'ab', content: 'Too short title.' })
        .send();

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: 'BAD_REQUEST', status: 400 },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects an undeclared body field with an UNKNOWN_FIELD detail', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app
        .request('POST', '/posts')
        .body({ title: 'Valid title', content: 'ok', authorId: 'untrusted' })
        .send();

      expect(response.status).toBe(400);
      const error = (response.body as { error: { code: string; details?: { code: string }[] } })
        .error;
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.details?.some((detail) => detail.code === 'UNKNOWN_FIELD')).toBe(true);
    } finally {
      await app.close();
    }
  });
});
