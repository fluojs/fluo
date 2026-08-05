import { Controller, createHandlerMapping, Post } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiBody, ApiQuery, ApiResponse } from './decorators.js';
import { buildOpenApiDocument } from './schema-builder.js';

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
});
