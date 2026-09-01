import {
  All,
  Controller,
  createHandlerMapping,
  Delete,
  Get,
  Head,
  Options,
  Patch,
  Post,
  Put,
  Route,
} from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from './schema-builder.js';

const DOCUMENT_OPTIONS = {
  defaultErrorResponsesPolicy: 'omit' as const,
  title: 'Path Item API',
  version: '1.0.0',
};

function resolveLocalJsonPointerTarget(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith('#/')) {
    return undefined;
  }

  return decodeURIComponent(pointer.slice(2)).split('/').reduce<unknown>((current, token) => {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }

    return Reflect.get(current, token.replaceAll('~1', '/').replaceAll('~0', '~'));
  }, value);
}

function collectLocalJsonReferences(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  const reference = Reflect.get(value, '$ref');
  return [
    ...(typeof reference === 'string' && reference.startsWith('#/') ? [reference] : []),
    ...Object.values(value).flatMap(collectLocalJsonReferences),
  ];
}

describe('OpenAPI Path Item validation', () => {
  it('rejects ALL descriptors instead of emitting a nonstandard operation', () => {
    // Given
    @Controller('/fallback')
    class FallbackController {
      @All('/') handle() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: FallbackController }]).descriptors;

    // When
    const buildDocument = () => buildOpenApiDocument({ ...DOCUMENT_OPTIONS, descriptors });

    // Then
    expect(buildDocument).toThrow('OpenAPI cannot document unsupported HTTP method "ALL" for path "/fallback".');
  });

  it.each(['QUERY', 'BREW'])('rejects unsupported %s descriptor methods deterministically', (method) => {
    // Given
    @Controller('/unsupported')
    class UnsupportedController {
      @Get('/') handle() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: UnsupportedController }]).descriptors;
    const descriptor = descriptors[0];
    if (descriptor === undefined) {
      throw new TypeError('Expected the unsupported-method fixture to create one descriptor.');
    }
    Reflect.set(descriptor.route, 'method', method);

    // When
    const buildDocument = () => buildOpenApiDocument({ ...DOCUMENT_OPTIONS, descriptors });

    // Then
    expect(buildDocument).toThrow(`OpenAPI cannot document unsupported HTTP method "${method}" for path "/unsupported".`);
  });

  it('emits TRACE descriptors as standard OpenAPI operations', () => {
    // Given
    @Controller('/trace')
    class TraceController {
      @Route('TRACE', '/') trace() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: TraceController }]).descriptors;

    // When
    const document = buildOpenApiDocument({ ...DOCUMENT_OPTIONS, descriptors });

    // Then
    expect(document.paths['/trace']?.trace).toEqual(expect.objectContaining({
      operationId: 'TraceController_trace_trace_trace',
    }));
  });

  it('emits every operation supported by Fluo descriptors', () => {
    // Given
    @Controller('/methods')
    class MethodsController {
      @Get('/') get() { return undefined; }
      @Put('/') put() { return undefined; }
      @Post('/') post() { return undefined; }
      @Delete('/') delete() { return undefined; }
      @Options('/') options() { return undefined; }
      @Head('/') head() { return undefined; }
      @Patch('/') patch() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: MethodsController }]).descriptors;

    // When
    const document = buildOpenApiDocument({ ...DOCUMENT_OPTIONS, descriptors });

    // Then
    expect(Object.keys(document.paths['/methods'] ?? {}).sort()).toEqual([
      'delete', 'get', 'head', 'options', 'patch', 'post', 'put',
    ]);
    expect(document.openapi).toBe('3.1.0');
  });

  it.each(['all', 'query', 'connect'])('rejects transformed Path Item key %s', (key) => {
    // Given
    @Controller('/health')
    class HealthController {
      @Get('/') getHealth() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: HealthController }]).descriptors;

    // When
    const buildDocument = () => buildOpenApiDocument({
      ...DOCUMENT_OPTIONS,
      descriptors,
      documentTransform: (document) => {
        const pathItem = document.paths['/health'];
        if (pathItem === undefined) {
          throw new TypeError('Expected the transformed document to contain the health path.');
        }
        Reflect.set(pathItem, key, pathItem.get);
        return document;
      },
    });

    // Then
    expect(buildDocument).toThrow(`OpenAPI Path Item for path "/health" contains unsupported key "${key}".`);
  });

  it('normalizes schemas in transformed Path Item parameters', () => {
    // Given
    const descriptors: readonly [] = [];

    // When
    const document = buildOpenApiDocument({
      ...DOCUMENT_OPTIONS,
      descriptors,
      documentTransform: (generatedDocument) => ({
        ...generatedDocument,
        paths: {
          '/scores': {
            parameters: [{
              in: 'query',
              name: 'minimum-score',
              schema: {
                exclusiveMinimum: true,
                minimum: 0,
                nullable: true,
                type: 'number',
              },
            }],
          },
        },
      }),
    });

    // Then
    expect(document.paths['/scores']?.parameters).toEqual([{
      in: 'query',
      name: 'minimum-score',
      schema: { exclusiveMinimum: 0, type: ['number', 'null'] },
    }]);
  });

  it('preserves transformed trace, fixed fields, and specification extensions', () => {
    // Given
    @Controller('/health')
    class HealthController {
      @Get('/') getHealth() { return undefined; }
    }
    const descriptors = createHandlerMapping([{ controllerToken: HealthController }]).descriptors;

    // When
    const document = buildOpenApiDocument({
      ...DOCUMENT_OPTIONS,
      descriptors,
      documentTransform: (generatedDocument) => {
        const operation = generatedDocument.paths['/health']?.get;
        if (operation === undefined) {
          throw new TypeError('Expected the transformed document to contain the health GET operation.');
        }
        return {
          ...generatedDocument,
          paths: {
            '/health': {
              description: 'Health operations',
              get: operation,
              parameters: [{ in: 'header', name: 'x-request-id', schema: { type: 'string' } }],
              servers: [{ url: 'https://api.example.com' }],
              summary: 'Health',
              trace: { ...operation, operationId: 'traceHealth' },
              'x-owner': 'platform',
            },
            '/health-reference': {
              $ref: '#/paths/~1health',
            },
          },
        };
      },
    });

    // Then
    expect(document.paths['/health']).toEqual({
      description: 'Health operations',
      get: expect.objectContaining({ responses: { 200: { description: 'OK' } } }),
      parameters: [{ in: 'header', name: 'x-request-id', schema: { type: 'string' } }],
      servers: [{ url: 'https://api.example.com' }],
      summary: 'Health',
      trace: expect.objectContaining({ operationId: 'traceHealth' }),
      'x-owner': 'platform',
    });
    expect(document.paths['/health-reference']).toEqual({ $ref: '#/paths/~1health' });
    const serializedDocument: unknown = JSON.parse(JSON.stringify(document));
    expect(serializedDocument).toMatchObject({
      info: {
        title: 'Path Item API',
        version: '1.0.0',
      },
      openapi: '3.1.0',
      paths: {
        '/health': {
          get: { responses: { 200: { description: 'OK' } } },
          trace: { responses: { 200: { description: 'OK' } } },
        },
        '/health-reference': { $ref: '#/paths/~1health' },
      },
    });
    const localReferences = collectLocalJsonReferences(serializedDocument);
    expect(localReferences).toEqual(['#/paths/~1health']);
    expect(localReferences.filter((reference) => resolveLocalJsonPointerTarget(serializedDocument, reference) === undefined))
      .toEqual([]);
    expect(resolveLocalJsonPointerTarget(serializedDocument, '#/paths/~1health')).toMatchObject({
      get: { responses: { 200: { description: 'OK' } } },
      trace: { responses: { 200: { description: 'OK' } } },
    });
  });
});
