import { Controller, createHandlerMapping, Get, Version } from '@fluojs/http';
import { createRuntimeRouteCatalog } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { createReactPageCatalog } from './page-catalog.js';

function createGetRequest(path: string) {
  return {
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('React page catalog', () => {
  it('projects only React page markers from authoritative compiled descriptors', () => {
    // Given
    @Version('1')
    @Router('/products')
    class ProductRouter {
      @Version('2')
      @Path('/:productId')
      show(): void {}
    }

    @Controller('/health')
    class HealthController {
      @Get('/')
      check(): void {}
    }

    class AppModule {}

    const mapping = createHandlerMapping([
      { controllerToken: ProductRouter, moduleType: AppModule },
      { controllerToken: HealthController, moduleType: AppModule },
    ]);
    const matchBeforeProjection = mapping.match(createGetRequest('/v2/products/sku-42'));

    // When
    const catalog = createReactPageCatalog(mapping.descriptors);
    const runtimeRoutes = createRuntimeRouteCatalog(mapping.descriptors);
    expect(() => {
      (mapping.descriptors[0]?.metadata.pathParams as unknown as string[]).push('mutated-after-projection');
    }).toThrow(TypeError);
    const matchAfterProjection = mapping.match(createGetRequest('/v2/products/sku-42'));

    // Then
    expect(catalog).toEqual([
      {
        handler: 'show',
        id: 'GET /v2/products/:productId ProductRouter show',
        kind: 'react-page',
        method: 'GET',
        module: 'AppModule',
        params: ['productId'],
        path: '/v2/products/:productId',
        router: 'ProductRouter',
        version: '2',
      },
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0])).toBe(true);
    expect(Object.isFrozen(catalog[0]?.params)).toBe(true);
    expect(runtimeRoutes.map((route) => route.kind)).toEqual(['react-page', 'http']);
    expect(matchAfterProjection?.descriptor).toBe(matchBeforeProjection?.descriptor);
    expect(matchAfterProjection?.params).toEqual({ productId: 'sku-42' });
  });
});
