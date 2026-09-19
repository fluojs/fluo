import { Controller, createHandlerMapping, Post } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiBody, ApiQuery, ApiResponse } from './decorators.js';
import { OpenApiDocumentBuilder } from './schema-builder.js';

describe('OpenAPI 3.1 exclusive bounds', () => {
  it('preserves finite numeric exclusive bounds through decorator content and responses', () => {
    @Controller('/bounds')
    class BoundsController {
      @ApiQuery('cursor', { schema: { exclusiveMinimum: 0, type: 'integer' } })
      @ApiBody({
        content: {
          'application/json': {
            schema: { properties: { ratio: { exclusiveMaximum: 1, type: 'number' } }, type: 'object' },
          },
        },
      })
      @ApiResponse({
        schema: { properties: { score: { exclusiveMinimum: -1, type: 'number' } }, type: 'object' },
        status: 200,
      })
      @Post('/')
      create() {}
    }

    const document = OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      descriptors: createHandlerMapping([{ controllerToken: BoundsController }]).descriptors,
      title: 'Bounds API',
      version: '1.0.0',
    });

    expect(document.paths['/bounds']?.post?.parameters?.[0]?.schema).toEqual({ exclusiveMinimum: 0, type: 'integer' });
    expect(document.paths['/bounds']?.post?.requestBody?.content['application/json']?.schema).toEqual({
      properties: { ratio: { exclusiveMaximum: 1, type: 'number' } },
      type: 'object',
    });
  });

  it('rejects boolean exclusive bounds injected by an untyped transform', () => {
    expect(() => OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      documentTransform: (document) => ({
        ...document,
        components: { schemas: { Legacy: { exclusiveMinimum: true, type: 'number' } } },
      }) as unknown as typeof document,
      title: 'Legacy Bounds API',
      version: '1.0.0',
    })).toThrowError(/boolean exclusiveMinimum/i);
  });
});
