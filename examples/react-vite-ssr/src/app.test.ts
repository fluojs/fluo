import { Module } from '@fluojs/core';
import { Path, ReactModule, Router } from '@fluojs/react';
import { Test } from '@fluojs/testing';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
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
  'src/navigation-product.ts': {
    file: 'navigation-product-hash.js',
    isDynamicEntry: true,
    src: 'src/navigation-product.ts',
  },
  'src/navigation-admin.ts': {
    file: 'navigation-admin-hash.js',
    isDynamicEntry: true,
    src: 'src/navigation-admin.ts',
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
  it('reports a missing application page renderer through real request dispatch', async () => {
    // Given: an explicit React page returns one element without configuring renderPage.
    const diagnostics: string[] = [];

    @Router('/missing-renderer')
    class MissingRendererRouter {
      @Path('/')
      show() {
        return createElement('main', null, 'Missing renderer');
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [MissingRendererRouter],
        onDiagnostic(diagnostic) {
          diagnostics.push(diagnostic.code);
        },
      })],
    })
    class MissingRendererModule {}

    const app = await Test.createApp({ rootModule: MissingRendererModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the virtual HTTP client dispatches the page request.
      const response = await app.request('GET', '/missing-renderer/').send();

      // Then: HTTP owns the failure response and React emits its stable configuration diagnostic.
      expect(response.status).toBe(500);
      expect(diagnostics).toEqual(['react-ssr-missing-page-renderer']);
    });
  });

  it('streams a DTO-bound page with Vite hydration assets', async () => {
    // Given: a fluo React module backed by a loaded Vite manifest.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
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
    });
  });

  it('negotiates the HTTP-matched page as a versioned browser destination', async () => {
    // Given: a page routed by HTTP with a build-bound destination module.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the client explicitly asks for the navigation representation.
      const response = await app.request('GET', '/products/sku-42')
        .query('preview', 'true')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1')
        .send();

      // Then: the selected route's URL and params, not a browser matcher, identify the destination.
      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toBe('application/vnd.fluo.react-navigation+json;v=1');
      expect(response.headers.Vary).toContain('Accept');
      expect(response.body).toEqual({
        version: 1,
        url: '/products/sku-42?preview=true',
        params: { sku: 'sku-42' },
        destination: {
          module: './navigation-product.ts',
          props: { preview: true, productName: 'Catalog item sku-42', sku: 'sku-42' },
        },
      });
    });
  });

  it('grants anonymous public prefetch but retains private navigation for restricted fixtures', async () => {
    // Given: a real HTTP dispatcher and a build-mapped destination.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the browser negotiates an explicitly public page and restricted pages.
      const publicResponse = await app.request('GET', '/prefetch/public-84')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1').send();
      const cookieResponse = await app.request('GET', '/prefetch/public-84')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1')
        .header('cookie', 'session=alice').send();
      const privateResponse = await app.request('GET', '/prefetch/private')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1').send();

      // Then: only an anonymous, server-declared identity-independent page is reusable.
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.headers['X-Fluo-Navigation-Prefetch']).toBe('public');
      expect(publicResponse.headers['Cache-Control']).toBe('public, max-age=15');
      expect(publicResponse.body).toMatchObject({
        version: 1,
        url: '/prefetch/public-84',
        params: { scenario: 'public-84' },
        destination: { module: './navigation-product.ts' },
      });
      expect(cookieResponse.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      expect(cookieResponse.headers['Cache-Control']).toContain('no-store');
      expect(privateResponse.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      expect(privateResponse.headers['Cache-Control']).toContain('no-store');
    });
  });

  it('retains application response restrictions and rejects auth, redirects, and missing pages', async () => {
    // Given: HTTP-owned prefetch fixtures with pre-existing response policy or credentials.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const navigation = (scenario: string) => app.request('GET', `/prefetch/${scenario}`)
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1');

      // When: the same negotiated route runs under each policy.
      const noStore = await navigation('no-store').send();
      const setCookie = await navigation('set-cookie').send();
      const varyCookie = await navigation('vary-cookie').send();
      const authDenied = await navigation('auth').send();
      const authAllowed = await navigation('auth').header('cookie', 'session=alice').send();
      const redirect = await navigation('redirect').send();
      const missing = await navigation('missing').send();

      // Then: none of the denied cases gains the public grant.
      for (const response of [noStore, setCookie, varyCookie, authDenied, authAllowed, redirect, missing]) {
        expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      }
      expect(noStore.headers['Cache-Control']).toContain('no-store');
      expect(setCookie.headers['Set-Cookie']).toContain('prefetch-example=1');
      expect(varyCookie.headers.Vary).toContain('Cookie');
      expect(authDenied.status).toBe(403);
      expect(authAllowed.status).toBe(200);
      expect(redirect.status).toBe(302);
      expect(missing.status).toBe(404);
    });
  });

  it('dispatches admin QR and songs as ordinary documents and approved destinations', async () => {
    // Given: two explicit HTTP routes sharing one client destination module.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());

      // When: each route receives a direct GET and a negotiated browser request.
      for (const [path, heading] of [['/admin/qr', 'Admin QR'], ['/admin/songs', 'Admin songs']]) {
        const document = await app.request('GET', path).send();
        const navigation = await app.request('GET', path)
          .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1').send();

        // Then: only HTTP chooses a page and produces the confirmed URL and module.
        expect(document.status, JSON.stringify(document.body)).toBe(200);
        expect(readHtml(document.body)).toContain(heading);
        expect(navigation.body).toEqual({
          version: 1,
          url: path,
          params: {},
          destination: { module: './navigation-admin.ts', props: { page: path.split('/').at(-1) } },
        });
      }
    });
  });

  it('keeps path and query validation on the server-owned DTO boundary', async () => {
    // Given: a fluo React route whose path and query fields have validation rules.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: navigation reaches the server with invalid path and query values.
      const response = await app.request('GET', '/products/x')
        .query('preview', 'maybe')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=1')
        .send();

      // Then: HTTP DTO validation rejects the request before React rendering.
      expect(response.status).toBe(400);
      expect(response.headers['Content-Type']).not.toBe('application/vnd.fluo.react-navigation+json;v=1');
    });
  });

  it('protects native form mutations with the ordinary HTTP guard pipeline', async () => {
    // Given: a rendered React product whose mutation route requires application authorization.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: an unauthenticated native-form payload reaches the ordinary POST route.
      const response = await app.request('POST', '/products/sku-42').body({ name: 'Renamed catalog item' }).send();

      // Then: the route guard rejects the mutation before application state changes.
      expect(response.status).toBe(403);
    });
  });

  it('returns a safe 400 representation for invalid native form input', async () => {
    // Given: an authorized request to the ordinary HTTP mutation route.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the submitted product name violates the request DTO contract.
      const response = await app
        .request('POST', '/products/sku-42')
        .header('x-example-user', 'catalog-editor')
        .header('x-request-id', 'native-form-invalid')
        .body({ name: 'x' })
        .send();

      // Then: the canonical validation envelope exposes safe field-level details.
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'BAD_REQUEST',
          details: [
            {
              code: 'PRODUCT_NAME_TOO_SHORT',
              field: 'name',
              message: 'Product name must contain at least 3 characters.',
              source: 'body',
            },
          ],
          message: 'Validation failed.',
          meta: undefined,
          requestId: 'native-form-invalid',
          status: 400,
        },
      });
    });
  });

  it('redirects a successful native form mutation with 303 See Other', async () => {
    // Given: an authorized editor submitting a valid product mutation.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the ordinary POST handler accepts the bound request DTO.
      const response = await app
        .request('POST', '/products/sku-42')
        .header('x-example-user', 'catalog-editor')
        .body({ name: 'Renamed catalog item' })
        .send();

      // Then: the handler sends the browser back through the ordinary GET dispatcher.
      expect(response.status).toBe(303);
      expect(response.headers.location).toBe('/products/sku-42?updated=true');
      expect(response.headers['x-example-middleware']).toBe('react-native-form');
      expect(response.headers['x-example-interceptor']).toBe('request-scoped');
    });
  });

  it('reapproves changed current-page data through the real HTTP dispatcher', async () => {
    // Given: a DTO-bound page and an authorized external mutation on the same app.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const accept = 'application/vnd.fluo.react-navigation+json;v=1';
      const before = await app.request('GET', '/products/sku-42').query('preview', 'true')
        .header('Accept', accept).send();

      // When: a native POST updates the backing name, then the same negotiated GET runs again.
      const mutation = await app.request('POST', '/products/sku-42')
        .header('x-example-user', 'catalog-editor').body({ name: 'Fresh catalog name' }).send();
      const after = await app.request('GET', '/products/sku-42').query('preview', 'true')
        .header('Accept', accept).send();
      const invalid = await app.request('GET', '/products/x').query('preview', 'true')
        .header('Accept', accept).send();
      const document = await app.request('GET', '/products/sku-42').query('preview', 'true').send();

      // Then: each request passes HTTP DTO, guard, interceptor and a new request scope.
      expect(before.body).toMatchObject({
        destination: { props: { productName: 'Catalog item sku-42' } },
      });
      expect(mutation.status).toBe(303);
      expect(after.body).toMatchObject({
        params: { sku: 'sku-42' },
        destination: { props: { productName: 'Fresh catalog name' } },
      });
      expect(after.headers['x-example-read-guard']).toBe('approved');
      expect(after.headers['x-example-interceptor']).toBe('request-scoped');
      expect(after.headers['x-example-request-scope']).not.toBe(before.headers['x-example-request-scope']);
      expect(invalid.status).toBe(400);
      expect(document.status).toBe(200);
      expect(document.headers['Content-Type']).toContain('text/html');
      expect(readHtml(document.body)).toContain('Fresh catalog name');
    });
  });
});
