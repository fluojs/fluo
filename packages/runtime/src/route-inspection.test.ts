import type { HandlerDescriptor } from '@fluojs/http';
import { describe, expect, it } from 'vitest';
import { handlerToStudioRouteDescriptor } from './devtools/snapshot.js';
import { defineStandardRuntimeRouteInspectionMetadata } from './internal.js';
import { createRuntimeInspectionSnapshot } from './route-inspection.js';

function RouteKind(kind: string) {
  return (_value: Function, context: ClassMethodDecoratorContext): void => {
    defineStandardRuntimeRouteInspectionMetadata(context.metadata, context.name, { kind });
  };
}

class CatalogModule {}

class CatalogController {
  @RouteKind('react-page')
  show(): void {}
}

class HealthController {
  check(): void {}
}

function createDescriptor(
  controllerToken: HandlerDescriptor['controllerToken'],
  methodName: string,
  path: string,
  pathParams: string[],
  version?: string,
): HandlerDescriptor {
  return {
    controllerToken,
    metadata: {
      controllerPath: '',
      effectivePath: path,
      effectiveVersion: version,
      moduleMiddleware: [],
      moduleType: CatalogModule,
      pathParams,
    },
    methodName,
    route: {
      method: 'GET',
      path,
      version,
    },
  };
}

describe('runtime route inspection', () => {
  it('exports the runtime-owned route inspection projection from the package root', async () => {
    // Given
    const runtime = await import('./index.js');

    // When
    const exportedProjection = Reflect.get(runtime, 'createRuntimeInspectionSnapshot');

    // Then
    expect(exportedProjection).toEqual(expect.any(Function));
  });

  it('projects effective descriptor fields and runtime-neutral route kinds without mutating inputs', () => {
    // Given
    const reactParams = ['productId'];
    const descriptors = [
      createDescriptor(CatalogController, 'show', '/v2/products/:productId', reactParams, '2'),
      createDescriptor(HealthController, 'check', '/health', []),
    ];
    const platformSnapshot = {
      components: [],
      diagnostics: [],
      generatedAt: '2026-07-28T00:00:00.000Z',
      health: { status: 'healthy' as const },
      readiness: { critical: false, status: 'ready' as const },
    };

    // When
    const snapshot = createRuntimeInspectionSnapshot(platformSnapshot, descriptors);
    reactParams.push('mutated-after-projection');

    // Then
    expect(snapshot.routes).toEqual([
      {
        controller: 'CatalogController',
        handler: 'show',
        id: 'GET /v2/products/:productId CatalogController show',
        kind: 'react-page',
        method: 'GET',
        module: 'CatalogModule',
        params: ['productId'],
        path: '/v2/products/:productId',
        version: '2',
      },
      {
        controller: 'HealthController',
        handler: 'check',
        id: 'GET /health HealthController check',
        kind: 'http',
        method: 'GET',
        module: 'CatalogModule',
        params: [],
        path: '/health',
      },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.routes)).toBe(true);
    expect(Object.isFrozen(snapshot.routes[0])).toBe(true);
    expect(Object.isFrozen(snapshot.routes[0]?.params)).toBe(true);
    expect(platformSnapshot).not.toHaveProperty('routes');
  });

  it('carries route kind and effective params into live Studio descriptors', () => {
    // Given
    const descriptor = createDescriptor(
      CatalogController,
      'show',
      '/v2/products/:productId',
      ['productId'],
      '2',
    );

    // When
    const route = handlerToStudioRouteDescriptor(descriptor);

    // Then
    expect(route).toEqual({
      controller: 'CatalogController',
      handler: 'show',
      id: 'GET /v2/products/:productId CatalogController show',
      kind: 'react-page',
      method: 'GET',
      module: 'CatalogModule',
      params: ['productId'],
      path: '/v2/products/:productId',
      version: '2',
    });
  });
});
