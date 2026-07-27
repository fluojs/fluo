import { Controller, createHandlerMapping, Post } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiBody, ApiQuery, ApiResponse } from './decorators.js';
import { buildOpenApiDocument, type OpenApiSchemaObject } from './schema-builder.js';

describe('OpenAPI 3.1 exclusive bounds', () => {
  it('emits numeric exclusive bounds when typed metadata uses legacy booleans', () => {
    // Given
    @Controller('/bounds')
    class BoundsController {
      @ApiQuery('cursor', {
        schema: {
          exclusiveMinimum: true,
          minimum: 0,
          type: 'integer',
        },
      })
      @ApiBody({
        schema: {
          properties: {
            ratio: {
              exclusiveMaximum: true,
              maximum: 1,
              type: 'number',
            },
          },
          type: 'object',
        },
      })
      @ApiResponse(200, {
        schema: {
          properties: {
            inclusiveFloor: {
              exclusiveMinimum: false,
              minimum: 0,
              type: 'number',
            },
            score: {
              exclusiveMinimum: -1,
              type: 'number',
            },
          },
          type: 'object',
        },
      })
      @Post('/')
      create() {
        return { score: 0 };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: BoundsController }]).descriptors;

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Bounds API',
      version: '1.0.0',
    });
    const operation = document.paths['/bounds']?.post;

    // Then
    expect({
      parameter: operation?.parameters?.[0]?.schema,
      request: operation?.requestBody?.content['application/json']?.schema,
      response: operation?.responses['200']?.content?.['application/json']?.schema,
    }).toEqual({
      parameter: {
        exclusiveMinimum: 0,
        type: 'integer',
      },
      request: {
        properties: {
          ratio: {
            exclusiveMaximum: 1,
            type: 'number',
          },
        },
        type: 'object',
      },
      response: {
        properties: {
          inclusiveFloor: {
            minimum: 0,
            type: 'number',
          },
          score: {
            exclusiveMinimum: -1,
            type: 'number',
          },
        },
        type: 'object',
      },
    });
  });

  it('normalizes exclusive bounds added by the final document transform', () => {
    // Given
    const options = {
      defaultErrorResponsesPolicy: 'omit' as const,
      descriptors: [],
      documentTransform: (document: ReturnType<typeof buildOpenApiDocument>) => ({
        ...document,
        components: {
          schemas: {
            TransformedScore: {
              exclusiveMaximum: true,
              maximum: 100,
              type: 'number' as const,
            },
          },
        },
      }),
      title: 'Transformed Bounds API',
      version: '1.0.0',
    };

    // When
    const document = buildOpenApiDocument(options);

    // Then
    expect(document.components?.schemas?.TransformedScore).toEqual({
      exclusiveMaximum: 100,
      type: 'number',
    });
  });

  it('preserves a transformed schema self-cycle while normalizing its bounds', () => {
    // Given
    const properties: Record<string, OpenApiSchemaObject> = {};
    const recursiveSchema: OpenApiSchemaObject = {
      exclusiveMinimum: true,
      minimum: 0,
      properties,
      type: 'object',
    };
    properties.self = recursiveSchema;

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors: [],
      documentTransform: (generatedDocument) => ({
        ...generatedDocument,
        components: {
          schemas: { RecursiveSchema: recursiveSchema },
        },
      }),
      title: 'Recursive Bounds API',
      version: '1.0.0',
    });
    const normalizedSchema = document.components?.schemas?.RecursiveSchema;

    // Then
    expect(normalizedSchema).toMatchObject({ exclusiveMinimum: 0, type: 'object' });
    expect(normalizedSchema?.minimum).toBeUndefined();
    expect(normalizedSchema?.properties?.self).toBe(normalizedSchema);
  });

  it('preserves shared schema identity in a transformed DAG while normalizing its bounds', () => {
    // Given
    const sharedBound: OpenApiSchemaObject = {
      exclusiveMaximum: true,
      maximum: 10,
      type: 'number',
    };
    const transformedSchema: OpenApiSchemaObject = {
      properties: {
        first: sharedBound,
        second: sharedBound,
      },
      type: 'object',
    };

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors: [],
      documentTransform: (generatedDocument) => ({
        ...generatedDocument,
        components: {
          schemas: { TransformedDag: transformedSchema },
        },
      }),
      title: 'Shared Bounds API',
      version: '1.0.0',
    });
    const normalizedProperties = document.components?.schemas?.TransformedDag?.properties;

    // Then
    expect(normalizedProperties?.first).toEqual({ exclusiveMaximum: 10, type: 'number' });
    expect(normalizedProperties?.first).toBe(normalizedProperties?.second);
  });

  it('rejects a true legacy exclusive bound when its numeric bound is missing', () => {
    // Given
    @Controller('/invalid-bounds')
    class InvalidBoundsController {
      @ApiResponse(200, {
        schema: {
          exclusiveMinimum: true,
          type: 'number',
        },
      })
      @Post('/')
      create() {
        return 1;
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: InvalidBoundsController }]).descriptors;

    // When
    const buildDocument = () => buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Invalid Bounds API',
      version: '1.0.0',
    });

    // Then
    expect(buildDocument).toThrowError(TypeError);
  });

  it('rejects a non-finite numeric exclusive bound', () => {
    // Given
    @Controller('/non-finite-bounds')
    class NonFiniteBoundsController {
      @ApiResponse(200, {
        schema: {
          exclusiveMaximum: Number.POSITIVE_INFINITY,
          type: 'number',
        },
      })
      @Post('/')
      create() {
        return 1;
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: NonFiniteBoundsController }]).descriptors;

    // When
    const buildDocument = () => buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Non-finite Bounds API',
      version: '1.0.0',
    });

    // Then
    expect(buildDocument).toThrowError(TypeError);
  });
});
