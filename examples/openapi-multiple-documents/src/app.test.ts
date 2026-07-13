import { describe, expect, it } from 'vitest';

import { createTestApp } from '@fluojs/testing';

import { AppModule } from './app';

describe('AppModule e2e', () => {
  it('serves two OpenAPI documents and Swagger UIs at distinct paths', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    try {
      await expect(app.request('GET', '/openapi/public.json').send()).resolves.toMatchObject({
        body: {
          info: {
            title: 'Public API',
            version: '1.0.0',
          },
        },
        status: 200,
      });
      await expect(app.request('GET', '/openapi/admin.json').send()).resolves.toMatchObject({
        body: {
          info: {
            title: 'Admin API',
            version: '1.0.0',
          },
        },
        status: 200,
      });

      const publicUi = await app.request('GET', '/docs/public').send();
      expect(publicUi.status).toBe(200);
      expect(publicUi.body).toContain('"/openapi/public.json"');

      const adminUi = await app.request('GET', '/docs/admin').send();
      expect(adminUi.status).toBe(200);
      expect(adminUi.body).toContain('"/openapi/admin.json"');
    } finally {
      await app.close();
    }
  });
});
