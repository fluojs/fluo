import { Controller, createHandlerMapping, Post } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiBody, ApiQuery, ApiResponse } from './decorators.js';
import { buildOpenApiDocument, type OpenApiSchemaObject } from './schema-builder.js';

describe('OpenAPI 3.1 nullable schemas', () => {
  it('emits null type unions for scalar and array legacy nullable schemas', () => {
    // Given
    @Controller('/nullable')
    class NullableController {
      @ApiQuery('filter', {
        schema: {
          nullable: true,
          type: 'string',
        },
      })
      @ApiBody({
        schema: {
          items: { type: 'string' },
          nullable: true,
          type: 'array',
        },
      })
      @Post('/')
      create() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: NullableController }]).descriptors;

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Nullable API',
      version: '1.0.0',
    });
    const operation = document.paths['/nullable']?.post;

    // Then
    expect({
      parameter: operation?.parameters?.[0]?.schema,
      request: operation?.requestBody?.content['application/json']?.schema,
    }).toEqual({
      parameter: {
        type: ['string', 'null'],
      },
      request: {
        items: { type: 'string' },
        type: ['array', 'null'],
      },
    });
  });

  it('removes a false legacy nullable keyword without changing the schema type', () => {
    // Given
    @Controller('/required')
    class RequiredController {
      @ApiQuery('limit', {
        schema: {
          minimum: 0,
          nullable: false,
          type: 'integer',
        },
      })
      @Post('/')
      create() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: RequiredController }]).descriptors;

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Required API',
      version: '1.0.0',
    });

    // Then
    expect(document.paths['/required']?.post?.parameters?.[0]?.schema).toEqual({
      minimum: 0,
      type: 'integer',
    });
  });

  it('emits a null union without discarding a legacy nullable reference', () => {
    // Given
    @Controller('/referenced')
    class ReferencedController {
      @ApiResponse(200, {
        schema: {
          $ref: '#/components/schemas/Result',
          nullable: true,
        },
      })
      @Post('/')
      create() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ReferencedController }]).descriptors;

    // When
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Referenced API',
      version: '1.0.0',
    });

    // Then
    expect(document.paths['/referenced']?.post?.responses['200']?.content?.['application/json']?.schema).toEqual({
      anyOf: [
        { $ref: '#/components/schemas/Result' },
        { type: 'null' },
      ],
    });
  });

  it('normalizes transformed nested schemas without duplicating existing null unions', () => {
    // Given
    const transformedSchema: OpenApiSchemaObject = {
      properties: {
        tags: {
          items: {
            nullable: true,
            type: 'string',
          },
          nullable: false,
          type: 'array',
        },
        title: {
          nullable: true,
          type: ['string', 'null'],
        },
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
          schemas: { TransformedPayload: transformedSchema },
        },
      }),
      title: 'Transformed Nullable API',
      version: '1.0.0',
    });

    // Then
    expect(document.components?.schemas?.TransformedPayload).toEqual({
      properties: {
        tags: {
          items: {
            type: ['string', 'null'],
          },
          type: 'array',
        },
        title: {
          type: ['string', 'null'],
        },
      },
      type: 'object',
    });
    expect(JSON.stringify(document)).not.toContain('"nullable"');
  });

  it('preserves a transformed nullable schema self-cycle', () => {
    // Given
    const properties: Record<string, OpenApiSchemaObject> = {};
    const recursiveSchema: OpenApiSchemaObject = {
      nullable: true,
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
          schemas: { RecursivePayload: recursiveSchema },
        },
      }),
      title: 'Recursive Nullable API',
      version: '1.0.0',
    });
    const normalizedSchema = document.components?.schemas?.RecursivePayload;

    // Then
    expect(normalizedSchema).toMatchObject({ type: ['object', 'null'] });
    expect(normalizedSchema?.properties?.self).toBe(normalizedSchema);
  });

  it('preserves shared nullable schema identity while wrapping references', () => {
    // Given
    const sharedReference: OpenApiSchemaObject = {
      $ref: '#/components/schemas/Result',
      nullable: true,
    };
    const transformedSchema: OpenApiSchemaObject = {
      properties: {
        first: sharedReference,
        second: sharedReference,
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
          schemas: { SharedPayload: transformedSchema },
        },
      }),
      title: 'Shared Nullable API',
      version: '1.0.0',
    });
    const normalizedProperties = document.components?.schemas?.SharedPayload?.properties;

    // Then
    expect(normalizedProperties?.first).toEqual({
      anyOf: [
        { $ref: '#/components/schemas/Result' },
        { type: 'null' },
      ],
    });
    expect(normalizedProperties?.first).toBe(normalizedProperties?.second);
  });
});
