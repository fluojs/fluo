import { describe, expect, it } from 'vitest';

import { IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from '@konekti/dto-validator';
import { Controller, Get, Post, Version, createHandlerMapping, type FrameworkRequest, type FrameworkResponse } from '@konekti/http';
import { FromBody, FromCookie, RequestDto } from '@konekti/http';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTag } from './decorators.js';
import { OpenApiModule } from './openapi-module.js';

type TestFrameworkResponse = FrameworkResponse & { body?: unknown };

function createRequest(method: string, path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestFrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('OpenApiModule', () => {
  it('serves an augmented OpenAPI 3.1 document with DTO schemas at /openapi.json', async () => {
    class AddressDto {
      @FromBody('city')
      @IsString()
      @MinLength(1)
      city = '';
    }

    class CreateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(1)
      name = '';

      @FromBody('nickname')
      @IsOptional()
      @IsString()
      nickname?: string;

      @FromBody('address')
      @ValidateNested(() => AddressDto)
      address = new AddressDto();
    }

    class UserResponseDto {
      @IsString()
      id = '';

      @IsBoolean()
      created = true;
    }

    @ApiTag('users')
    @Controller('/users')
    class UsersController {
      @ApiOperation({ description: 'Creates a new user in the starter system.', summary: 'Create user' })
      @ApiBearerAuth()
      @ApiResponse(201, { description: 'Created', type: UserResponseDto })
      @Get('/')
      listUsers() {
        return [{ id: '1' }];
      }

      @RequestDto(CreateUserRequest)
      @ApiOperation({ summary: 'Create user' })
      @ApiResponse(201, { description: 'Created', type: UserResponseDto })
      @Post('/')
      createUser() {
        return { id: '2' };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'Test API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          schemas: expect.objectContaining({
            AddressDto: {
              additionalProperties: false,
              properties: {
                city: {
                  minLength: 1,
                  type: 'string',
                },
              },
              required: ['city'],
              type: 'object',
            },
            CreateUserRequest: {
              additionalProperties: false,
              properties: {
                address: {
                  $ref: '#/components/schemas/AddressDto',
                },
                name: {
                  minLength: 1,
                  type: 'string',
                },
                nickname: {
                  type: 'string',
                },
              },
              required: ['name', 'address'],
              type: 'object',
            },
            UserResponseDto: {
              additionalProperties: false,
              properties: {
                created: {
                  type: 'boolean',
                },
                id: {
                  type: 'string',
                },
              },
              required: ['id', 'created'],
              type: 'object',
            },
          }),
          securitySchemes: {
            bearerAuth: {
              bearerFormat: 'JWT',
              scheme: 'bearer',
              type: 'http',
            },
          },
        }),
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        openapi: '3.1.0',
        paths: {
          '/users': {
            get: expect.objectContaining({
              responses: {
                '201': {
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/UserResponseDto',
                      },
                    },
                  },
                  description: 'Created',
                },
              },
              security: [{ bearerAuth: [] }],
              summary: 'Create user',
              tags: ['users'],
            }),
            post: expect.objectContaining({
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/CreateUserRequest',
                    },
                  },
                },
                required: true,
              },
              responses: {
                '201': {
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/UserResponseDto',
                      },
                    },
                  },
                  description: 'Created',
                },
              },
              summary: 'Create user',
              tags: ['users'],
            }),
          },
        },
      }),
    );
  });

  it('serves Swagger UI at /docs when ui is enabled', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: HealthController }]).descriptors;
    const openApiModule = OpenApiModule.forRoot({
      descriptors,
      title: 'Docs API',
      ui: true,
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [HealthController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/docs'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.body).toEqual(expect.stringContaining("url: '/openapi.json'"));
    expect(response.body).toEqual(expect.stringContaining('SwaggerUIBundle'));
  });

  it('documents cookie parameters and optional-only request bodies accurately', async () => {
    class SessionCookieRequest {
      @FromCookie('session')
      @IsString()
      session = '';
    }

    class PatchProfileRequest {
      @FromBody('nickname')
      @IsOptional()
      @IsString()
      nickname?: string;
    }

    @Controller('/profile')
    class ProfileController {
      @Get('/session')
      @RequestDto(SessionCookieRequest)
      getSession() {
        return { ok: true };
      }

      @Post('/optional')
      @RequestDto(PatchProfileRequest)
      updateProfile() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: ProfileController }],
      title: 'Profile API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [ProfileController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        paths: expect.objectContaining({
          '/profile/session': expect.objectContaining({
            get: expect.objectContaining({
              parameters: [
                {
                  in: 'cookie',
                  name: 'session',
                  required: true,
                  schema: {
                    type: 'string',
                  },
                },
              ],
            }),
          }),
          '/profile/optional': expect.objectContaining({
            post: expect.objectContaining({
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/PatchProfileRequest',
                    },
                  },
                },
              },
            }),
          }),
        }),
      }),
    );

    expect((response.body as { paths: Record<string, { post?: { requestBody?: { required?: boolean } } }> }).paths['/profile/optional']?.post?.requestBody?.required).toBeUndefined();
  });

  it('emits URI-versioned paths and operation ids for versioned handlers', async () => {
    @Version('1')
    @Controller('/users')
    class UsersController {
      @Get('/')
      listUsers() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Post('/')
      createUser() {
        return { id: '2' };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'Versioned API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        paths: {
          '/v1/users': {
            get: expect.objectContaining({
              operationId: 'UsersController_listUsers_get_v1_users',
            }),
          },
          '/v2/users': {
            post: expect.objectContaining({
              operationId: 'UsersController_createUser_post_v2_users',
            }),
          },
        },
      }),
    );
  });
});
