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
} from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from './schema-builder.js';

const DOCUMENT_OPTIONS = {
  defaultErrorResponsesPolicy: 'omit' as const,
  title: 'Path Item API',
  version: '1.0.0',
};

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
              $ref: '#/components/pathItems/Health',
              description: 'Health operations',
              parameters: [{ in: 'header', name: 'x-request-id', schema: { type: 'string' } }],
              servers: [{ url: 'https://api.example.com' }],
              summary: 'Health',
              trace: { ...operation, operationId: 'traceHealth' },
              'x-owner': 'platform',
            },
          },
        };
      },
    });

    // Then
    expect(document.paths['/health']).toEqual({
      $ref: '#/components/pathItems/Health',
      description: 'Health operations',
      parameters: [{ in: 'header', name: 'x-request-id', schema: { type: 'string' } }],
      servers: [{ url: 'https://api.example.com' }],
      summary: 'Health',
      trace: expect.objectContaining({ operationId: 'traceHealth' }),
      'x-owner': 'platform',
    });
    expect(JSON.parse(JSON.stringify(document))).toMatchObject({ openapi: '3.1.0' });
  });
});
