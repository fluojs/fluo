import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from './http-guide-app';

/**
 * Composition fixture for the HTTP and Validation package guides
 * (apps/docs/content/docs/packages/http.mdx, validation.mdx).
 *
 * Exercises the full request pipeline through Test.createApp: DTO binding with
 * validation rules, InputPolicy strip/reject, guards, and the canonical error
 * envelope. All assertions target machine-observable outcomes.
 */

describe('package-guides http composition', () => {
  it('binds and validates the create-user body', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const rejected = await app.request('POST', '/users').body({ name: 'ab' }).send();
      expect(rejected.status).toBe(400);
      expect(rejected.body).toMatchObject({ error: { code: 'BAD_REQUEST', status: 400 } });

      const created = await app.request('POST', '/users').body({ name: 'Grace' }).send();
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ id: '2', name: 'Grace' });
    } finally {
      await app.close();
    }
  });

  it('reports a missing required field with a MISSING_FIELD detail', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app.request('POST', '/users').body({}).send();

      expect(response.status).toBe(400);
      const error = (response.body as { error: { code: string; details?: { code: string }[] } }).error;
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.details?.some((detail) => detail.code === 'MISSING_FIELD')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('maps a thrown NotFoundException to the canonical 404 envelope', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app.request('GET', '/users/999').send();

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: { code: 'NOT_FOUND', status: 404, message: 'User 999 was not found.' },
      });
    } finally {
      await app.close();
    }
  });

  it('strips unknown body fields under the DTO InputPolicy', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app
        .request('POST', '/drafts')
        .body({ post_title: 'Draft', authorId: 'untrusted' })
        .send();

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ title: 'Draft' });
    } finally {
      await app.close();
    }
  });

  it('rejects unknown body fields on the route that overrides the policy', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const response = await app
        .request('POST', '/drafts/strict')
        .body({ post_title: 'Draft', authorId: 'untrusted' })
        .send();

      expect(response.status).toBe(400);
      const error = (response.body as { error: { code: string; details?: { code: string }[] } }).error;
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.details?.some((detail) => detail.code === 'UNKNOWN_FIELD')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('rejects a guard failure with 403 and admits the authorized request', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    try {
      const denied = await app.request('GET', '/admin').send();
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ error: { code: 'FORBIDDEN', status: 403 } });

      const admitted = await app.request('GET', '/admin').header('x-admin-token', 'admin-secret').send();
      expect(admitted.status).toBe(200);
      expect(admitted.body).toEqual({ data: 'secret' });
    } finally {
      await app.close();
    }
  });
});
