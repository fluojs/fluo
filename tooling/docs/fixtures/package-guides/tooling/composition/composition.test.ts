import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHandlerMapping } from '@fluojs/http';
import { createReactPageCatalog } from '@fluojs/react';
import { generateReactPageTypes, inspectReactPageTypeArtifact } from '@fluojs/react/typegen';
import { parseStudioPayload, renderMermaid } from '@fluojs/studio';
import { Test } from '@fluojs/testing';
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { describe, expect, it } from 'vitest';
import { readTransformedCode, runDecoratorsTransform } from '../vite/run-transform';
import { CatalogApiController, CatalogPageRouter, CompositionRootModule } from './app';

/**
 * Cross-package composition evidence for the tooling guides: one application
 * where @fluojs/react page handlers and an ordinary @fluojs/http controller
 * share one provider, @fluojs/testing drives the real dispatcher, the React
 * page catalog feeds path-only typegen, @fluojs/studio parses the composed
 * routes, and @fluojs/vite compiles the module's decorators.
 */

describe('tooling package guide composition', () => {
  it('serves the catalog through the API controller and the React page handler', async () => {
    const app = await Test.createApp({ rootModule: CompositionRootModule });

    try {
      const api = await app.request('GET', '/api/catalog/sku-9').send();
      expect(api.status).toBe(200);
      expect(api.body).toEqual({ sku: 'sku-9', title: 'Item sku-9' });

      const page = await app.request('GET', '/catalog/sku-42').send();
      expect(page.status).toBe(200);
      expect(page.body).toEqual({ sku: 'sku-42', title: 'Item sku-42' });
    } finally {
      await app.close();
    }
  });

  it('projects the React page catalog and generates a valid path-only artifact', () => {
    const mapping = createHandlerMapping([
      { controllerToken: CatalogPageRouter },
      { controllerToken: CatalogApiController },
    ]);
    const pages = createReactPageCatalog(mapping.descriptors);

    expect(pages).toHaveLength(1);
    const [page] = pages;
    if (!page) {
      throw new Error('expected the composed React page entry');
    }

    expect(page).toEqual(
      expect.objectContaining({
        kind: 'react-page',
        method: 'GET',
        path: '/catalog/:sku',
        params: ['sku'],
        router: 'CatalogPageRouter',
        handler: 'show',
        id: 'GET /catalog/:sku CatalogPageRouter show',
      }),
    );

    const artifact = generateReactPageTypes(pages);
    expect(inspectReactPageTypeArtifact(artifact)).toEqual({ status: 'valid', version: 1 });
  });

  it('normalizes the composed routes for Studio and renders deterministic Mermaid', () => {
    const inspection = {
      generatedAt: '2026-09-21T00:00:00.000Z',
      readiness: { status: 'ready', critical: false },
      health: { status: 'healthy' },
      components: [],
      diagnostics: [],
      routes: [
        {
          id: 'GET /catalog/:sku CatalogPageRouter show',
          kind: 'react-page',
          method: 'GET',
          path: '/catalog/:sku',
          controller: 'CatalogPageRouter',
          handler: 'show',
          params: ['sku'],
        },
        {
          id: 'GET /api/catalog/:sku CatalogApiController get',
          method: 'GET',
          path: '/api/catalog/:sku',
          controller: 'CatalogApiController',
          handler: 'get',
        },
      ],
    };

    const { payload } = parseStudioPayload(JSON.stringify({ snapshot: inspection }));
    const snapshot = payload.snapshot;
    if (!snapshot) {
      throw new Error('expected the parsed composition snapshot');
    }

    const routes = snapshot.routes ?? [];
    expect(routes[0]?.kind).toBe('react-page');
    expect(routes[0]?.graphNodeId).toMatch(/^route:/);
    expect(routes[1]?.kind).toBe('http');
    expect(routes[1]?.params).toEqual([]);

    const reparsed = parseStudioPayload(JSON.stringify({ snapshot })).payload.snapshot;
    if (!reparsed) {
      throw new Error('expected the reparsed composition snapshot');
    }
    expect(renderMermaid(reparsed)).toBe(renderMermaid(snapshot));
  });

  it('compiles the composition app decorators through the fluo Vite transform', async () => {
    const appPath = fileURLToPath(new URL('./app.ts', import.meta.url));
    const plugin = fluoDecoratorsPlugin();
    const result = await runDecoratorsTransform(plugin, readFileSync(appPath, 'utf8'), appPath);

    const code = readTransformedCode(result);
    expect(code).toContain('@fluojs/core/metadata-preload');
    expect(code).not.toContain('@Inject(');
  });
});
