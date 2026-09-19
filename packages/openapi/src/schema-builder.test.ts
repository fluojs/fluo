import { Controller, createHandlerMapping, FromBody, Get, HttpCode, Post, Produces, RequestDto } from '@fluojs/http';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from '@fluojs/validation';
import { IntersectionType } from '@fluojs/validation/mapped-types';
import { describe, expect, it } from 'vitest';

import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiSecurity, ApiTag } from './decorators.js';
import { buildOpenApiDocument } from './schema-builder.js';

describe('buildOpenApiDocument', () => {
  it('generates required path parameters from route templates without DTO bindings', () => {
    @Controller('/accounts/:accountId/resources')
    class ResourcesController {
      @Get('/:resourceId')
      get() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ResourcesController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Route Parameters API',
      version: '1.0.0',
    });

    expect(document.paths['/accounts/{accountId}/resources/{resourceId}']?.get?.parameters).toEqual([
      {
        in: 'path',
        name: 'accountId',
        required: true,
        schema: { type: 'string' },
      },
      {
        in: 'path',
        name: 'resourceId',
        required: true,
        schema: { type: 'string' },
      },
    ]);
  });

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

  it('emits only accepted numeric enum values with a numeric type', () => {
    enum NumericStatus {
      __proto__ = 0,
      Published,
    }

    class UpdatePostRequest {
      @FromBody('status')
      @IsEnum(NumericStatus)
      status = 0;
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
          enum: [0, 1], type: 'number',
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

  it('emits declared produces media types for schema responses', () => {
    class ExportResponse {
      @IsString()
      value = '';
    }

    @Controller('/exports')
    class ExportController {
      @Produces('application/json', 'application/problem+json')
      @ApiResponse(200, { description: 'Exported payload', type: ExportResponse })
      @Get('/')
      list() {
        return { value: 'ok' };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ExportController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Export API',
      version: '1.0.0',
    });

    expect(document.paths['/exports']?.get?.responses['200']).toEqual({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/ExportResponse',
          },
        },
        'application/problem+json': {
          schema: {
            $ref: '#/components/schemas/ExportResponse',
          },
        },
      },
      description: 'Exported payload',
    });
  });

  it('aligns implicit response statuses with HTTP route defaults', () => {
    @Controller('/implicit-status')
    class ImplicitStatusController {
      @Post('/')
      create() {
        return { created: true };
      }

      @Get('/')
      list() {
        return [];
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ImplicitStatusController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Implicit Status API',
      version: '1.0.0',
    });

    expect(document.paths['/implicit-status']?.post?.responses).toEqual({
      '201': { description: 'OK' },
    });
    expect(document.paths['/implicit-status']?.get?.responses).toEqual({
      '200': { description: 'OK' },
    });
  });

  it('keeps explicit ApiResponse statuses ahead of HTTP route defaults', () => {
    @Controller('/explicit-status')
    class ExplicitStatusController {
      @ApiResponse(202, { description: 'Accepted for async processing' })
      @Post('/')
      create() {
        return { accepted: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ExplicitStatusController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Explicit Status API',
      version: '1.0.0',
    });

    expect(document.paths['/explicit-status']?.post?.responses).toEqual({
      '202': { description: 'Accepted for async processing' },
    });
  });

  it('reflects explicit HttpCode overrides in response statuses', () => {
    @Controller('/http-code-status')
    class HttpCodeStatusController {
      @HttpCode(204)
      @Post('/')
      create() {
        return undefined;
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: HttpCodeStatusController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'HTTP Code Status API',
      version: '1.0.0',
    });

    expect(document.paths['/http-code-status']?.post?.responses).toEqual({
      '204': { description: 'OK' },
    });
  });

  it('uses controller names as default tags when @ApiTag is absent', () => {
    @Controller('/untagged')
    class UntaggedController {
      @Get('/')
      getUntagged() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: UntaggedController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Default Tags API',
      version: '1.0.0',
    });

    expect(document.paths['/untagged']?.get?.tags).toEqual(['UntaggedController']);
    expect(document.paths['/untagged']?.get?.operationId).toBe('UntaggedController_getUntagged_get_untagged');
  });

  it('merges stacked same-scheme ApiSecurity scopes into a cumulative requirement', () => {
    @Controller('/reports')
    class ReportsController {
      @ApiSecurity('oauth2Auth', ['reports:read'])
      @ApiSecurity('oauth2Auth', ['reports:write', 'reports:read'])
      @ApiSecurity('apiKeyAuth')
      @Get('/')
      list() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ReportsController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
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
                'reports:read': 'Read reports',
                'reports:write': 'Write reports',
              },
              tokenUrl: 'https://example.com/oauth/token',
            },
          },
          type: 'oauth2',
        },
      },
      title: 'Reports API',
      version: '1.0.0',
    });

    expect(document.paths['/reports']?.get?.security).toEqual([
      { apiKeyAuth: [] },
      { oauth2Auth: ['reports:write', 'reports:read'] },
    ]);
  });

  it('detaches configured security schemes from generated document output', () => {
    @Controller('/security-snapshot')
    class SecuritySnapshotController {
      @ApiSecurity('apiKeyAuth')
      @Get('/')
      list() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: SecuritySnapshotController }]).descriptors;
    const securitySchemes = {
      apiKeyAuth: {
        in: 'header' as const,
        name: 'x-api-key',
        type: 'apiKey' as const,
      },
    };
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      securitySchemes,
      title: 'Security Snapshot API',
      version: '1.0.0',
    });

    securitySchemes.apiKeyAuth.name = 'mutated-api-key';

    expect(document.components?.securitySchemes?.apiKeyAuth).toEqual({
      in: 'header',
      name: 'x-api-key',
      type: 'apiKey',
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

  it('dedupes duplicate path and method descriptors with later descriptor precedence', () => {
    @Controller('/dedupe')
    class SourceController {
      @ApiOperation({ summary: 'source operation' })
      @Get('/')
      read() {
        return { source: true };
      }
    }

    @Controller('/dedupe')
    class ExplicitController {
      @ApiOperation({ summary: 'explicit operation' })
      @Get('/')
      read() {
        return { explicit: true };
      }
    }

    const sourceDescriptors = createHandlerMapping([{ controllerToken: SourceController }]).descriptors;
    const explicitDescriptors = createHandlerMapping([{ controllerToken: ExplicitController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors: [...sourceDescriptors, ...explicitDescriptors],
      title: 'Dedupe API',
      version: '1.0.0',
    });

    expect(document.paths['/dedupe']?.get?.summary).toBe('explicit operation');
    expect(document.paths['/dedupe']?.get?.operationId).toBe('ExplicitController_read_get_dedupe');
  });

  it('keeps operationIds unique when normalized operation names collide', () => {
    @ApiTag('Reports')
    @Controller('/reports-export')
    class ReportsExportController {
      @Get('/')
      list() {
        return [];
      }
    }

    @ApiTag('Reports')
    @Controller('/reports_export')
    class ReportsUnderscoreController {
      @Get('/')
      list() {
        return [];
      }
    }

    const descriptors = createHandlerMapping([
      { controllerToken: ReportsExportController },
      { controllerToken: ReportsUnderscoreController },
    ]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Operation ID API',
      version: '1.0.0',
    });

    expect(document.paths['/reports-export']?.get?.operationId).toBe('Reports_list_get_reports_export');
    expect(document.paths['/reports_export']?.get?.operationId).toBe('Reports_list_get_reports_export_2');
  });

  it('preserves explicit multipart request-body content', () => {
    @Controller('/uploads')
    class UploadsController {
      @ApiBody({
        content: {
          'multipart/form-data': {
            schema: {
              properties: {
                file: { format: 'binary', type: 'string' },
              },
              required: ['file'],
              type: 'object',
            },
          },
        },
        required: true,
      })
      @Post('/')
      upload() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: UploadsController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Multipart API',
      version: '1.0.0',
    });

    expect(document.paths['/uploads']?.post?.requestBody).toEqual({
      content: {
        'multipart/form-data': {
          schema: {
            properties: {
              file: { format: 'binary', type: 'string' },
            },
            required: ['file'],
            type: 'object',
          },
        },
      },
      required: true,
    });
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

  it('preserves explicit OpenAPI schema keywords from request and response decorators', () => {
    @Controller('/schema-surface')
    class SchemaSurfaceController {
      @ApiResponse(200, {
        description: 'Schema keyword response',
        schema: {
          additionalProperties: {
            type: 'string',
          },
          deprecated: true,
          examples: [{ mode: 'preview' }],
          pattern: '^[a-z]+$',
          properties: {
            id: { readOnly: true, type: 'string' },
            mode: { default: 'preview', enum: ['preview', 'live'], type: 'string' },
          },
          required: ['id'],
          type: 'object',
        },
      })
      @Get('/response')
      response() {
        return { id: 'schema-1', mode: 'preview' };
      }

      @ApiBody({
        schema: {
          properties: {
            tags: {
              items: { type: 'string' },
              maxItems: 5,
              minItems: 1,
              type: 'array',
              uniqueItems: true,
            },
            title: {
              minLength: 1,
              nullable: true,
              type: ['string', 'null'],
              writeOnly: true,
            },
          },
          type: 'object',
        },
      })
      @Post('/request')
      request() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: SchemaSurfaceController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Schema Surface API',
      version: '1.0.0',
    });

    expect(document.paths['/schema-surface/response']?.get?.responses['200']).toEqual({
      content: {
        'application/json': {
          schema: {
            additionalProperties: {
              type: 'string',
            },
            deprecated: true,
            examples: [{ mode: 'preview' }],
            pattern: '^[a-z]+$',
            properties: {
              id: { readOnly: true, type: 'string' },
              mode: { default: 'preview', enum: ['preview', 'live'], type: 'string' },
            },
            required: ['id'],
            type: 'object',
          },
        },
      },
      description: 'Schema keyword response',
    });
    expect(document.paths['/schema-surface/request']?.post?.requestBody).toEqual({
      content: {
        'application/json': {
          schema: {
            properties: {
              tags: {
                items: { type: 'string' },
                maxItems: 5,
                minItems: 1,
                type: 'array',
                uniqueItems: true,
              },
              title: {
                minLength: 1,
                type: ['string', 'null'],
                writeOnly: true,
              },
            },
            type: 'object',
          },
        },
      },
    });
  });

  it('projects combined validation constraints independently of decorator order', () => {
    class ChildDto {
      @FromBody('name')
      @IsString()
      name = '';
    }

    enum State {
      Archived = 'archived',
      Draft = 'draft',
      Published = 'published',
    }

    class ValidationProjectionDto {
      @FromBody('title')
      @IsString()
      @MinLength(3)
      @MaxLength(6)
      @Length(4, 5)
      title = '';

      @FromBody('tags')
      @IsArray()
      @IsString({ each: true })
      @ArrayMaxSize(8)
      @ArrayMinSize(2)
      @ArrayMaxSize(5)
      @ArrayMinSize(4)
      tags: string[] = [];

      @FromBody('state')
      @IsEnum(State)
      @IsIn([State.Draft, State.Published])
      state = State.Draft;

      @FromBody('score')
      @IsNumber()
      @Min(0)
      @Min(10)
      @Max(100)
      @Max(80)
      score = 10;

      @FromBody('children')
      @ValidateNested(() => ChildDto, { each: true })
      @ValidateNested(() => ChildDto)
      children: ChildDto[] = [];
    }

    @Controller('/validation-projection')
    class ValidationProjectionController {
      @RequestDto(ValidationProjectionDto)
      @Post('/')
      create() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: ValidationProjectionController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Validation Projection API',
      version: '1.0.0',
    });

    expect(document.components?.schemas?.ValidationProjectionDto).toEqual({
      additionalProperties: false,
      properties: {
        children: {
          items: { $ref: '#/components/schemas/ChildDto' },
          type: 'array',
        },
        score: {
          maximum: 80,
          minimum: 10,
          type: 'number',
        },
        state: {
          enum: ['draft', 'published'],
          type: 'string',
        },
        tags: {
          items: { type: 'string' },
          maxItems: 5,
          minItems: 4,
          type: 'array',
        },
        title: {
          maxLength: 5,
          minLength: 4,
          type: 'string',
        },
      },
      required: ['title', 'tags', 'state', 'score', 'children'],
      type: 'object',
    });
  });

  it('folds repeated numeric Min and Max rules independently of decorator order', () => {
    class NumericBoundsDto {
      @FromBody('quantity')
      @IsInt()
      @Min(5)
      @Min(10)
      @Min(2)
      quantity = 10;

      @FromBody('discount')
      @IsNumber()
      @Max(100)
      @Max(50)
      @Max(80)
      discount = 50;
    }

    class ReorderedNumericBoundsDto {
      @FromBody('quantity')
      @IsInt()
      @Min(2)
      @Min(10)
      @Min(5)
      quantity = 10;

      @FromBody('discount')
      @IsNumber()
      @Max(80)
      @Max(50)
      @Max(100)
      discount = 50;
    }

    @Controller('/numeric-bounds')
    class NumericBoundsController {
      @RequestDto(NumericBoundsDto)
      @Post('/standard')
      standard() {
        return { ok: true };
      }

      @RequestDto(ReorderedNumericBoundsDto)
      @Post('/reordered')
      reordered() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: NumericBoundsController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Numeric Bounds API',
      version: '1.0.0',
    });

    const expectedProperties = {
      discount: {
        maximum: 50,
        type: 'number',
      },
      quantity: {
        minimum: 10,
        type: 'integer',
      },
    };

    expect(document.components?.schemas?.NumericBoundsDto).toEqual({
      additionalProperties: false,
      properties: expectedProperties,
      required: ['quantity', 'discount'],
      type: 'object',
    });

    expect(document.components?.schemas?.ReorderedNumericBoundsDto).toEqual({
      additionalProperties: false,
      properties: expectedProperties,
      required: ['quantity', 'discount'],
      type: 'object',
    });
  });

  it('dedupes enum values, handles reordered IsIn and IsEnum, and emits impossible schema for disjoint constraints', () => {
    enum Status {
      Active = 'active',
      Inactive = 'inactive',
      Pending = 'pending',
    }

    class DuplicateAndReorderedDto {
      @FromBody('statusIsEnumFirst')
      @IsEnum(Status)
      @IsIn([Status.Active, Status.Active, Status.Pending])
      statusIsEnumFirst = Status.Active;

      @FromBody('statusIsInFirst')
      @IsIn([Status.Active, Status.Active, Status.Pending])
      @IsEnum(Status)
      statusIsInFirst = Status.Active;

      @FromBody('standaloneDuplicate')
      @IsIn(['apple', 'apple', 'banana'])
      standaloneDuplicate = 'apple';
    }

    class DisjointDto {
      @FromBody('disjointEnum')
      @IsEnum(Status)
      @IsIn(['unknown', 'other'])
      disjointEnum = 'unknown';

      @FromBody('disjointIsIn')
      @IsIn(['a', 'b'])
      @IsIn(['c', 'd'])
      disjointIsIn = 'a';

      @FromBody('disjointEach')
      @IsArray()
      @IsEnum(Status, { each: true })
      @IsIn(['unknown'], { each: true })
      disjointEach: string[] = [];
    }

    @Controller('/enum-handling')
    class EnumHandlingController {
      @RequestDto(DuplicateAndReorderedDto)
      @Post('/dedupe-reorder')
      dedupeReorder() {
        return { ok: true };
      }

      @RequestDto(DisjointDto)
      @Post('/disjoint')
      disjoint() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: EnumHandlingController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Enum Handling API',
      version: '1.0.0',
    });

    expect(document.components?.schemas?.DuplicateAndReorderedDto).toEqual({
      additionalProperties: false,
      properties: {
        standaloneDuplicate: {
          enum: ['apple', 'banana'],
          type: 'string',
        },
        statusIsEnumFirst: {
          enum: ['active', 'pending'],
          type: 'string',
        },
        statusIsInFirst: {
          enum: ['active', 'pending'],
          type: 'string',
        },
      },
      required: ['statusIsEnumFirst', 'statusIsInFirst', 'standaloneDuplicate'],
      type: 'object',
    });

    expect(document.components?.schemas?.DisjointDto).toEqual({
      additionalProperties: false,
      properties: {
        disjointEach: {
          items: { not: {} },
          type: 'array',
        },
        disjointEnum: {
          not: {},
        },
        disjointIsIn: {
          not: {},
        },
      },
      required: ['disjointEnum', 'disjointIsIn', 'disjointEach'],
      type: 'object',
    });
  });

  it('preserves every distinct ValidateNested target, composing collisions with allOf and deduplicating identical targets', () => {
    class NamedChildDto {
      @FromBody('name')
      @IsString()
      name = '';
    }

    class RankedChildDto {
      @FromBody('rank')
      @IsNumber()
      rank = 0;
    }

    class NamedParentDto {
      @FromBody('child')
      @ValidateNested(() => NamedChildDto)
      child = new NamedChildDto();
    }

    class RankedParentDto {
      @FromBody('child')
      @ValidateNested(() => RankedChildDto)
      child = new RankedChildDto();
    }

    class CombinedParentDto extends IntersectionType(NamedParentDto, RankedParentDto) {}

    class ReorderedNestedDto {
      @FromBody('child')
      @ValidateNested(() => RankedChildDto)
      @ValidateNested(() => NamedChildDto)
      child = new NamedChildDto();
    }

    class DedupedNestedDto {
      @FromBody('child')
      @ValidateNested(() => NamedChildDto)
      @ValidateNested(() => NamedChildDto)
      child = new NamedChildDto();
    }

    class MultiEachNestedDto {
      @FromBody('items')
      @ValidateNested(() => NamedChildDto, { each: true })
      @ValidateNested(() => RankedChildDto, { each: true })
      items = [];
    }

    class MixedNestedDto {
      @FromBody('items')
      @ValidateNested(() => NamedChildDto)
      @ValidateNested(() => RankedChildDto, { each: true })
      items = [];
    }

    @Controller('/nested-composition')
    class NestedCompositionController {
      @RequestDto(CombinedParentDto)
      @Post('/intersection')
      intersection() {
        return { ok: true };
      }

      @RequestDto(ReorderedNestedDto)
      @Post('/reordered')
      reordered() {
        return { ok: true };
      }

      @RequestDto(DedupedNestedDto)
      @Post('/deduped')
      deduped() {
        return { ok: true };
      }

      @RequestDto(MultiEachNestedDto)
      @Post('/multi-each')
      multiEach() {
        return { ok: true };
      }

      @RequestDto(MixedNestedDto)
      @Post('/mixed')
      mixed() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: NestedCompositionController }]).descriptors;
    const document = buildOpenApiDocument({
      defaultErrorResponsesPolicy: 'omit',
      descriptors,
      title: 'Nested Composition API',
      version: '1.0.0',
    });

    const expectedAllOfChild = {
      allOf: [
        { $ref: '#/components/schemas/NamedChildDto' },
        { $ref: '#/components/schemas/RankedChildDto' },
      ],
    };

    // IntersectionType collision must compose allOf and keep both schemas
    expect(document.components?.schemas?.CombinedParentDto).toEqual({
      additionalProperties: false,
      properties: {
        child: expectedAllOfChild,
      },
      required: ['child'],
      type: 'object',
    });

    // Reordered decorators must produce identical deterministic allOf
    expect(document.components?.schemas?.ReorderedNestedDto).toEqual({
      additionalProperties: false,
      properties: {
        child: expectedAllOfChild,
      },
      required: ['child'],
      type: 'object',
    });

    // Identical targets must dedupe without allOf wrapper
    expect(document.components?.schemas?.DedupedNestedDto).toEqual({
      additionalProperties: false,
      properties: {
        child: { $ref: '#/components/schemas/NamedChildDto' },
      },
      required: ['child'],
      type: 'object',
    });

    // Multiple { each: true } targets compose into items.allOf
    expect(document.components?.schemas?.MultiEachNestedDto).toEqual({
      additionalProperties: false,
      properties: {
        items: {
          items: expectedAllOfChild,
          type: 'array',
        },
      },
      required: ['items'],
      type: 'object',
    });

    // Scalar and each coexistence gives precedence to each-array
    expect(document.components?.schemas?.MixedNestedDto).toEqual({
      additionalProperties: false,
      properties: {
        items: {
          items: { $ref: '#/components/schemas/RankedChildDto' },
          type: 'array',
        },
      },
      required: ['items'],
      type: 'object',
    });

    // Both component schemas must exist
    expect(document.components?.schemas?.NamedChildDto).toBeDefined();
    expect(document.components?.schemas?.RankedChildDto).toBeDefined();
  });
});
