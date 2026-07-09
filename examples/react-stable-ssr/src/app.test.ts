import { createTestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app';

const TEXT_DECODER = new TextDecoder();

function readHtml(body: unknown): string {
  if (body instanceof Uint8Array) {
    return TEXT_DECODER.decode(body);
  }

  return typeof body === 'string' ? body : JSON.stringify(body);
}

describe('react-stable-ssr example', () => {
  it('renders a DTO-bound React page through the HTTP lifecycle', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    try {
      const response = await app.request('GET', '/products/sku-42').query('preview', 'true').send();
      const html = readHtml(response.body);

      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(response.headers['x-example-middleware']).toBe('react-stable-ssr');
      expect(response.headers['x-example-guard']).toBe('sku-42');
      expect(response.headers['x-example-interceptor']).toBe('before-render');
      expect(response.headers['x-example-route']).toBe('react-page');
      expect(response.headers['x-example-entry']).toBe('react-server-entry');
      expect(html).toContain('Catalog item sku-42');
      expect(html).toContain('Preview mode');
      expect(html).toContain('DTO-bound sku: sku-42');
      expect(html).toContain('/assets/react-stable-ssr.client.js');
      expect(html).toContain('window.__FLUO_REACT_STABLE_SSR__ = true;');
      expect(html.match(/src="\/assets\/react-stable-ssr\.client\.js"/gu) ?? []).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
