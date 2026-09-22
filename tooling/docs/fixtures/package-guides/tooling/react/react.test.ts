import { getModuleMetadata, Module } from '@fluojs/core';
import { Controller, createHandlerMapping, Get } from '@fluojs/http';
import {
  createReactPageCatalog,
  getReactPathMetadata,
  getReactRouterMetadata,
  Path,
  REACT_PAGE_RENDERER,
  ReactModule,
  type ReactPageCatalogEntry,
  type ReactPageRenderer,
  Router,
} from '@fluojs/react';
import {
  generateReactPageTypes,
  inspectReactPageTypeArtifact,
  ReactPageTypegenError,
} from '@fluojs/react/typegen';
import { extractModuleControllers, extractModuleProviders } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/react guide evidence: @Router/@Path metadata facades, the
 * ReactModule.forRoot registration shape, the bootstrap-resolved page catalog,
 * and deterministic path-only typegen. Direct SSR rendering is exercised by
 * packages/react's own suite; the tooling fixture workspace cannot resolve the
 * react peer from tooling/, so these tests cover the react seams that do not
 * import react at runtime.
 */

@Router('/products')
class ProductRouter {
  @Path('/:productId')
  show(): { productId: string } {
    return { productId: 'unused' };
  }
}

@Router()
class HomeRouter {
  @Path()
  index(): string {
    return 'unused';
  }
}

@Controller('/health')
class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'unused' };
  }
}

const renderPage: ReactPageRenderer = () => {
  throw new Error('the fixture renderer must never be invoked; pages return plain values');
};

describe('@fluojs/react guide examples', () => {
  it('writes HTTP-equivalent controller and GET metadata plus React markers', () => {
    expect(getReactRouterMetadata(ProductRouter)).toEqual({ kind: 'router', basePath: '/products' });
    expect(getReactPathMetadata(ProductRouter, 'show')).toEqual({ kind: 'path', path: '/:productId' });

    // @Path() and @Router() mean the empty path.
    expect(getReactRouterMetadata(HomeRouter)).toEqual({ kind: 'router', basePath: '' });
    expect(getReactPathMetadata(HomeRouter, 'index')).toEqual({ kind: 'path', path: '' });
  });

  it('registers routers through ordinary module metadata and exports the renderer token', () => {
    const reactModule = ReactModule.forRoot({ controllers: [ProductRouter], renderPage });

    expect(extractModuleControllers(reactModule)).toContain(ProductRouter);
    expect(extractModuleProviders(reactModule)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: REACT_PAGE_RENDERER, useValue: renderPage }),
      ]),
    );

    @Module({ imports: [reactModule] })
    class ReactFixtureRootModule {}

    expect(getModuleMetadata(ReactFixtureRootModule)?.imports).toContain(reactModule);
  });

  it('projects only React pages from compiled HTTP descriptors', () => {
    const mapping = createHandlerMapping([
      { controllerToken: ProductRouter },
      { controllerToken: HealthController },
    ]);
    const pages = createReactPageCatalog(mapping.descriptors);

    expect(pages).toHaveLength(1);
    const [page] = pages;
    if (!page) {
      throw new Error('catalog must contain the React page entry');
    }

    expect(page.kind).toBe('react-page');
    expect(page.method).toBe('GET');
    expect(page.path).toBe('/products/:productId');
    expect(page.params).toEqual(['productId']);
    expect(page.router).toBe('ProductRouter');
    expect(page.handler).toBe('show');
    expect(page.id).toBe('GET /products/:productId ProductRouter show');
  });

  it('generates a deterministic, inspectable path-only artifact', () => {
    const mapping = createHandlerMapping([{ controllerToken: ProductRouter }]);
    const catalog = createReactPageCatalog(mapping.descriptors);

    const artifact = generateReactPageTypes(catalog);
    expect(generateReactPageTypes(catalog)).toBe(artifact);
    expect(artifact).toContain('"GET /products/:productId ProductRouter show": "/products/:productId"');
    expect(inspectReactPageTypeArtifact(artifact)).toEqual({ status: 'valid', version: 1 });
  });

  it('rejects versioned catalog entries with a typed error', () => {
    const versioned: ReactPageCatalogEntry = {
      handler: 'show',
      id: 'GET /v2/products Router show',
      kind: 'react-page',
      method: 'GET',
      params: [],
      path: '/v2/products',
      router: 'Router',
      version: '2',
    };

    try {
      generateReactPageTypes([versioned]);
      expect.unreachable('versioned routes must fail path-only typegen');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ReactPageTypegenError);
      if (error instanceof ReactPageTypegenError) {
        expect(error.code).toBe('react-page-typegen-versioned-route-unsupported');
        expect(error.routeId).toBe(versioned.id);
      }
    }
  });
});
