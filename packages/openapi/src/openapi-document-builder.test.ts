import { Controller, Get, Version, createHandlerMapping } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { ApiOperation } from './decorators.js';
import { OpenApiDocumentBuilder } from './schema-builder.js';

describe('OpenApiDocumentBuilder', () => {
  it('builds one normalized operation set from sources and later explicit descriptors', () => {
    @Controller('/records')
    @Version('2')
    class SourceController {
      @ApiOperation({ summary: 'discovered source' })
      @Get('/')
      list() {
        return [];
      }
    }

    @Controller('/records')
    @Version('2')
    class ExplicitController {
      @ApiOperation({ summary: 'explicit descriptor' })
      @Get('/')
      list() {
        return [];
      }
    }

    const explicitDescriptors = createHandlerMapping([{ controllerToken: ExplicitController }]).descriptors;

    const document = OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      descriptors: explicitDescriptors,
      operationPathPrefix: '//api//',
      sources: [{ controllerToken: SourceController }],
      title: 'Builder API',
      version: '2.0.0',
    });

    expect(document.info.version).toBe('2.0.0');
    expect(document.paths).toEqual({
      '/api/v2/records': expect.objectContaining({
        get: expect.objectContaining({ summary: 'explicit descriptor' }),
      }),
    });
  });

  it('accepts no descriptors or sources without emitting empty paths', () => {
    expect(OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      title: 'Empty Builder API',
      version: '1.0.0',
    }).paths).toEqual({});
  });

  it('does not mutate explicit descriptor snapshots while prefixing operations', () => {
    @Controller('/immutable')
    class ImmutableController {
      @Get('/')
      list() {
        return [];
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ImmutableController }]).descriptors;
    const originalPath = descriptors[0]?.route.path;

    const document = OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      operationPathPrefix: '/api/',
      title: 'Immutable Builder API',
      version: '1.0.0',
    });

    expect(descriptors[0]?.route.path).toBe(originalPath);
    expect(document.paths).toHaveProperty('/api/immutable');
  });

  it('rejects legacy schema fields injected by an untyped document transform', () => {
    expect(() => OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      documentTransform: (document) => ({
        ...document,
        components: {
          schemas: {
            Legacy: {
              nullable: true,
              type: 'string',
            },
          },
        },
      }) as unknown as typeof document,
      title: 'Legacy Schema API',
      version: '1.0.0',
    })).toThrowError(/legacy nullable/i);

    expect(() => OpenApiDocumentBuilder.build({
      defaultErrorResponsesPolicy: 'omit',
      documentTransform: (document) => ({
        ...document,
        components: {
          schemas: {
            Legacy: {
              exclusiveMinimum: true,
              minimum: 0,
              type: 'number',
            },
          },
        },
      }) as unknown as typeof document,
      title: 'Legacy Bound API',
      version: '1.0.0',
    })).toThrowError(/boolean exclusiveMinimum/i);
  });
});
