import { Controller, createHandlerMapping, Post } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiBody, ApiQuery, ApiResponse } from './decorators.js';
import { OpenApiDocumentBuilder } from './schema-builder.js';

describe('OpenAPI 3.1 null schemas', () => {
  it('preserves explicit null unions and anyOf schemas', () => {
    @Controller('/nullable')
    class NullableController {
      @ApiQuery('filter', { schema: { type: ['string', 'null'] } })
      @ApiBody({
        content: {
          'application/json': {
            schema: { anyOf: [{ $ref: '#/components/schemas/Payload' }, { type: 'null' }] },
          },
        },
      })
      @ApiResponse({
        schema: { type: ['object', 'null'] },
        status: 200,
      })
      @Post('/')
      create() {}
    }

    const document = OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      descriptors: createHandlerMapping([{ controllerToken: NullableController }]).descriptors,
      title: 'Nullable API',
      version: '1.0.0',
    });

    expect(document.paths['/nullable']?.post?.parameters?.[0]?.schema).toEqual({ type: ['string', 'null'] });
    expect(document.paths['/nullable']?.post?.requestBody?.content['application/json']?.schema).toEqual({
      anyOf: [{ $ref: '#/components/schemas/Payload' }, { type: 'null' }],
    });
  });

  it('rejects legacy nullable input injected by an untyped transform', () => {
    expect(() => OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      documentTransform: (document) => ({
        ...document,
        components: { schemas: { Legacy: { nullable: true, type: 'string' } } },
      }) as unknown as typeof document,
      title: 'Legacy Nullable API',
      version: '1.0.0',
    })).toThrowError(/legacy nullable/i);
  });
});
