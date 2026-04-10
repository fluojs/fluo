import { describe, expect, it } from 'vitest';

import { IsArray, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from '@fluojs/validation';
import { Controller, FromBody, Get, Post, RequestDto, createHandlerMapping } from '@fluojs/http';

import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiSecurity } from './decorators.js';
import { buildOpenApiDocument } from './schema-builder.js';

describe('buildOpenApiDocument', () => {
  it('keeps nested request-body schemas stable', () => {
    class AuthorDto {
      @IsString()
      name = '';
    }

    class CreatePostRequest {
      @FromBody('title')
      @IsString()
      @MinLength(3)
      title = '';

      @FromBody('author')
      @ValidateNested(() => AuthorDto)
      author = new AuthorDto();

      @FromBody('tags')
      @IsOptional()
      @IsArray()
      @IsString({ each: true })
      tags: string[] = [];
    }

    @Controller('/posts')
    class PostsController {
      @RequestDto(CreatePostRequest)
      @Post('/')
      create() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: PostsController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Snapshot API',
      version: '1.0.0',
    });

    expect(document.components?.schemas).toMatchInlineSnapshot(`
      {
        "AuthorDto": {
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
            },
          },
          "required": [
            "name",
          ],
          "type": "object",
        },
        "CreatePostRequest": {
          "additionalProperties": false,
          "properties": {
            "author": {
              "$ref": "#/components/schemas/AuthorDto",
            },
            "tags": {
              "items": {
                "type": "string",
              },
              "type": "array",
            },
            "title": {
              "minLength": 3,
              "type": "string",
            },
          },
          "required": [
            "title",
            "author",
          ],
          "type": "object",
        },
      }
    `);

    expect(document.paths['/posts']?.post?.requestBody).toMatchInlineSnapshot(`
      {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CreatePostRequest",
            },
          },
        },
        "required": true,
      }
    `);
  });

  it('omits enum type when allowed values mix primitive kinds', () => {
    enum NumericStatus {
      Draft,
      Published,
    }

    class UpdatePostRequest {
      @FromBody('status')
      @IsEnum(NumericStatus)
      status = NumericStatus.Draft;
    }

    @Controller('/posts')
    class PostsController {
      @RequestDto(UpdatePostRequest)
      @Post('/status')
      update() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: PostsController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Enum API',
      version: '1.0.0',
    });

    expect(document.components?.schemas?.UpdatePostRequest).toEqual({
      additionalProperties: false,
      properties: {
        status: {
          enum: ['Draft', 'Published', 0, 1],
        },
      },
      required: ['status'],
      type: 'object',
    });
  });

  it('supports endpoint exclusion, operation deprecation, generic security schemes, and extra model registration', () => {
    class ExtraModel {
      @IsString()
      name = '';
    }

    @Controller('/admin')
    class AdminController {
      @ApiOperation({ deprecated: true, summary: 'Visible endpoint' })
      @ApiSecurity('apiKeyAuth')
      @Get('/visible')
      visible() {
        return { ok: true };
      }

      @ApiExcludeEndpoint()
      @Get('/internal')
      internal() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: AdminController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      extraModels: [ExtraModel],
      securitySchemes: {
        apiKeyAuth: {
          in: 'header',
          name: 'x-api-key',
          type: 'apiKey',
        },
        oauth2Auth: {
          flows: {
            clientCredentials: {
              scopes: {
                'read:admin': 'Read admin data',
              },
              tokenUrl: 'https://example.com/oauth/token',
            },
          },
          type: 'oauth2',
        },
      },
      title: 'Admin API',
      version: '1.0.0',
    });

    expect(document.paths['/admin/visible']?.get?.deprecated).toBe(true);
    expect(document.paths['/admin/visible']?.get?.security).toEqual([{ apiKeyAuth: [] }]);
    expect(document.paths['/admin/internal']).toBeUndefined();
    expect(document.components?.schemas?.ExtraModel).toEqual({
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
        },
      },
      required: ['name'],
      type: 'object',
    });
    expect(document.components?.securitySchemes).toEqual({
      apiKeyAuth: {
        in: 'header',
        name: 'x-api-key',
        type: 'apiKey',
      },
      oauth2Auth: {
        flows: {
          clientCredentials: {
            scopes: {
              'read:admin': 'Read admin data',
            },
            tokenUrl: 'https://example.com/oauth/token',
          },
        },
        type: 'oauth2',
      },
    });
  });

  it('keeps ApiBearerAuth compatibility while merging configured security schemes', () => {
    @Controller('/secure')
    class SecureController {
      @ApiBearerAuth()
      @Get('/')
      getSecure() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: SecureController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      securitySchemes: {
        apiKeyAuth: {
          in: 'header',
          name: 'x-api-key',
          type: 'apiKey',
        },
      },
      title: 'Secure API',
      version: '1.0.0',
    });

    expect(document.paths['/secure']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components?.securitySchemes).toEqual({
      apiKeyAuth: {
        in: 'header',
        name: 'x-api-key',
        type: 'apiKey',
      },
      bearerAuth: {
        bearerFormat: 'JWT',
        scheme: 'bearer',
        type: 'http',
      },
    });
  });

  it('applies documentTransform when provided and keeps defaults when absent', () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: HealthController }]).descriptors;
    const withoutTransform = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Health API',
      version: '1.0.0',
    });
    const withTransform = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      documentTransform: (document) => ({
        ...document,
        info: {
          ...document.info,
          title: `${document.info.title} (Transformed)`,
        },
      }),
      title: 'Health API',
      version: '1.0.0',
    });

    expect(withoutTransform.info.title).toBe('Health API');
    expect(withTransform.info.title).toBe('Health API (Transformed)');
    expect(withTransform.paths).toEqual(withoutTransform.paths);
  });

  it('emits explicit composition schemas from response and request decorators', () => {
    @Controller('/composition')
    class CompositionController {
      @ApiResponse(200, {
        description: 'Composed response',
        schema: {
          allOf: [
            {
              properties: {
                id: { type: 'string' },
              },
              type: 'object',
            },
            {
              properties: {
                role: { enum: ['admin', 'user'], type: 'string' },
              },
              required: ['role'],
              type: 'object',
            },
          ],
          discriminator: {
            propertyName: 'role',
          },
        },
      })
      @Get('/response')
      response() {
        return { id: '1', role: 'admin' };
      }

      @ApiBody({
        schema: {
          oneOf: [
            {
              properties: {
                name: { type: 'string' },
              },
              required: ['name'],
              type: 'object',
            },
            {
              properties: {
                email: { format: 'email', type: 'string' },
              },
              required: ['email'],
              type: 'object',
            },
          ],
        },
      })
      @Post('/request')
      request() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: CompositionController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Composition API',
      version: '1.0.0',
    });

    expect(document.paths['/composition/response']?.get?.responses['200']).toEqual({
      content: {
        'application/json': {
          schema: {
            allOf: [
              {
                properties: {
                  id: { type: 'string' },
                },
                type: 'object',
              },
              {
                properties: {
                  role: { enum: ['admin', 'user'], type: 'string' },
                },
                required: ['role'],
                type: 'object',
              },
            ],
            discriminator: {
              propertyName: 'role',
            },
          },
        },
      },
      description: 'Composed response',
    });

    expect(document.paths['/composition/request']?.post?.requestBody).toEqual({
      content: {
        'application/json': {
          schema: {
            oneOf: [
              {
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
                type: 'object',
              },
              {
                properties: {
                  email: { format: 'email', type: 'string' },
                },
                required: ['email'],
                type: 'object',
              },
            ],
          },
        },
      },
    });
  });
});
