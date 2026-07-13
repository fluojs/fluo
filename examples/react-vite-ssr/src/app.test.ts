import { createTestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { createReactViteExampleModule } from './app';

const VITE_MANIFEST = {
  'src/entry-client.ts': {
    css: ['example.css'],
    file: 'entry-client.js',
    imports: ['src/entry-server.ts'],
    isEntry: true,
    src: 'src/entry-client.ts',
  },
  'src/entry-server.ts': {
    file: 'entry-server.js',
    isEntry: true,
    src: 'src/entry-server.ts',
  },
} as const;

const TEXT_DECODER = new TextDecoder();

function readHtml(body: unknown): string {
  if (body instanceof Uint8Array) {
    return TEXT_DECODER.decode(body);
  }

  return typeof body === 'string' ? body : JSON.stringify(body);
}

describe('react-vite-ssr example', () => {
  it('streams a DTO-bound page with Vite hydration assets', async () => {
    // Given: a fluo React module backed by a loaded Vite manifest.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await createTestApp({ rootModule: AppModule });

    try {
      // When: the HTTP-owned route receives path and search parameters.
      const response = await app.request('GET', '/products/sku-42').query('preview', 'true').send();
      const html = readHtml(response.body);

      // Then: streamed server content and generated hydration assets share one response.
      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(html).toContain('Catalog item sku-42');
      expect(html).toContain('Preview mode');
      expect(html).toContain('Loading recommendations');
      expect(html).toContain('Recommended for sku-42');
      expect(html).toContain('src="/assets/entry-client.js"');
      expect(html).toContain('href="/assets/example.css"');
      expect(html).toContain('Current path: /products/sku-42');
      expect(html).toContain('Current preview: true');
      expect(html).toContain('Current URL: /products/sku-42?preview=true');
      expect(html).toContain('Current hash: unset');
      expect(html).toContain('href="/products/sku-84?preview=false"');
    } finally {
      await app.close();
    }
  });

  it('keeps path and query validation on the server-owned DTO boundary', async () => {
    // Given: a fluo React route whose path and query fields have validation rules.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await createTestApp({ rootModule: AppModule });

    try {
      // When: navigation reaches the server with invalid path and query values.
      const response = await app.request('GET', '/products/x').query('preview', 'maybe').send();

      // Then: HTTP DTO validation rejects the request before React rendering.
      expect(response.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
