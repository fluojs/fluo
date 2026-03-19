import { describe, expect, it } from 'vitest';

import { IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from '@konekti/dto-validator';
import { Controller, Get, IntersectionType, OmitType, PartialType, PickType, Post, Version, createHandlerMapping, type FrameworkRequest, type FrameworkResponse } from '@konekti/http';
import { FromBody, FromCookie, FromQuery, RequestDto } from '@konekti/http';
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
              responses: expect.objectContaining({
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
              }),
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
              responses: expect.objectContaining({
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
              }),
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

  it('emits preserved request schemas for mapped DTO helpers', async () => {
    class CreateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(1)
      name = '';

      @FromBody('email')
      @IsString()
      email = '';
    }

    class AddressRequest {
      @FromBody('city')
      @IsString()
      city = '';
    }

    const PickedUserRequest = PickType(CreateUserRequest, ['name']);
    const OmittedUserRequest = OmitType(CreateUserRequest, ['email']);
    const CreateUserWithAddressRequest = IntersectionType(CreateUserRequest, AddressRequest);

    @Controller('/mapped')
    class MappedController {
      @RequestDto(PickedUserRequest)
      @Post('/pick')
      pick() {
        return { ok: true };
      }

      @RequestDto(OmittedUserRequest)
      @Post('/omit')
      omit() {
        return { ok: true };
      }

      @RequestDto(CreateUserWithAddressRequest)
      @Post('/intersection')
      intersection() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: MappedController }],
      title: 'Mapped Type API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [MappedController],
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
            CreateUserRequestPickType: {
              additionalProperties: false,
              properties: {
                name: {
                  minLength: 1,
                  type: 'string',
                },
              },
              required: ['name'],
              type: 'object',
            },
            CreateUserRequestOmitType: {
              additionalProperties: false,
              properties: {
                name: {
                  minLength: 1,
                  type: 'string',
                },
              },
              required: ['name'],
              type: 'object',
            },
            CreateUserRequestAddressRequestIntersectionType: {
              additionalProperties: false,
              properties: {
                city: {
                  type: 'string',
                },
                email: {
                  type: 'string',
                },
                name: {
                  minLength: 1,
                  type: 'string',
                },
              },
              required: ['name', 'email', 'city'],
              type: 'object',
            },
          }),
        }),
        paths: expect.objectContaining({
          '/mapped/pick': expect.objectContaining({
            post: expect.objectContaining({
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/CreateUserRequestPickType',
                    },
                  },
                },
                required: true,
              },
            }),
          }),
          '/mapped/omit': expect.objectContaining({
            post: expect.objectContaining({
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/CreateUserRequestOmitType',
                    },
                  },
                },
                required: true,
              },
            }),
          }),
          '/mapped/intersection': expect.objectContaining({
            post: expect.objectContaining({
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/CreateUserRequestAddressRequestIntersectionType',
                    },
                  },
                },
                required: true,
              },
            }),
          }),
        }),
      }),
    );
  });

  it('emits optional request body and parameter semantics for PartialType DTOs', async () => {
    class UpdateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(1)
      name = '';

      @FromQuery('role')
      @IsString()
      role = '';
    }

    const PartialUpdateUserRequest = PartialType(UpdateUserRequest);

    @Controller('/partial')
    class PartialController {
      @RequestDto(PartialUpdateUserRequest)
      @Post('/users')
      updateUser() {
        return { ok: true };
      }

      @RequestDto(PartialUpdateUserRequest)
      @Get('/users')
      filterUsers() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: PartialController }],
      title: 'Partial API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [PartialController],
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
            UpdateUserRequestPartialTypeRequestBody: {
              additionalProperties: false,
              properties: {
                name: {
                  minLength: 1,
                  type: 'string',
                },
              },
              type: 'object',
            },
          }),
        }),
        paths: expect.objectContaining({
          '/partial/users': expect.objectContaining({
            get: expect.objectContaining({
              parameters: [
                {
                  in: 'query',
                  name: 'role',
                  required: false,
                  schema: {
                    type: 'string',
                  },
                },
              ],
            }),
            post: expect.objectContaining({
              parameters: [
                {
                  in: 'query',
                  name: 'role',
                  required: false,
                  schema: {
                    type: 'string',
                  },
                },
              ],
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/UpdateUserRequestPartialTypeRequestBody',
                    },
                  },
                },
              },
            }),
          }),
        }),
      }),
    );

    expect((response.body as { paths: Record<string, { post?: { requestBody?: { required?: boolean } } }> }).paths['/partial/users']?.post?.requestBody?.required).toBeUndefined();
  });

  it('emits correct response schemas when mapped DTO helpers are used with @ApiResponse', async () => {
    class UserResponseDto {
      @IsString()
      id = '';

      @IsString()
      name = '';

      @IsString()
      email = '';
    }

    const UserSummaryResponse = PickType(UserResponseDto, ['id', 'name']);
    const UserWithoutEmailResponse = OmitType(UserResponseDto, ['email']);
    const PartialUserResponse = PartialType(UserResponseDto);

    @Controller('/users')
    class UsersController {
      @ApiResponse(200, { description: 'User summary', type: UserSummaryResponse })
      @Get('/summary')
      getSummary() {
        return { id: '1', name: 'Alice' };
      }

      @ApiResponse(200, { description: 'User without email', type: UserWithoutEmailResponse })
      @Get('/no-email')
      getWithoutEmail() {
        return { id: '1', name: 'Alice' };
      }

      @ApiResponse(200, { description: 'Partial user', type: PartialUserResponse })
      @Get('/partial')
      getPartial() {
        return { id: '1' };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'Response Mapped Type API',
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
            UserResponseDtoPickType: {
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['id', 'name'],
              type: 'object',
            },
            UserResponseDtoOmitType: {
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['id', 'name'],
              type: 'object',
            },
            UserResponseDtoPartialType: {
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              },
              type: 'object',
            },
          }),
        }),
        paths: expect.objectContaining({
          '/users/summary': {
            get: expect.objectContaining({
              responses: expect.objectContaining({
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/UserResponseDtoPickType' },
                    },
                  },
                  description: 'User summary',
                },
              }),
            }),
          },
          '/users/no-email': {
            get: expect.objectContaining({
              responses: expect.objectContaining({
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/UserResponseDtoOmitType' },
                    },
                  },
                  description: 'User without email',
                },
              }),
            }),
          },
          '/users/partial': {
            get: expect.objectContaining({
              responses: expect.objectContaining({
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/UserResponseDtoPartialType' },
                    },
                  },
                  description: 'Partial user',
                },
              }),
            }),
          },
        }),
      }),
    );
  });

  it('keeps nested parameter schema refs at field level', async () => {
    class FilterDto {
      @IsString()
      term = '';
    }

    class SearchRequest {
      @FromQuery('filter')
      @ValidateNested(() => FilterDto)
      filter = new FilterDto();
    }

    @Controller('/search')
    class SearchController {
      @Get('/')
      @RequestDto(SearchRequest)
      search() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: SearchController }],
      title: 'Search API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [SearchController],
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
            FilterDto: expect.any(Object),
          }),
        }),
        paths: expect.objectContaining({
          '/search': {
            get: expect.objectContaining({
              parameters: [
                {
                  in: 'query',
                  name: 'filter',
                  required: true,
                  schema: {
                    $ref: '#/components/schemas/FilterDto',
                  },
                },
              ],
            }),
          },
        }),
      }),
    );
  });

  it('adds default error responses when @ApiResponse is absent', async () => {
    @Controller('/errors')
    class ErrorsController {
      @Get('/default')
      defaultHandler() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: ErrorsController }],
      title: 'Errors API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [ErrorsController],
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
            ErrorResponse: {
              additionalProperties: false,
              properties: {
                error: { type: 'string' },
                message: { type: 'string' },
                statusCode: { type: 'integer' },
              },
              required: ['statusCode', 'message', 'error'],
              type: 'object',
            },
          }),
        }),
        paths: expect.objectContaining({
          '/errors/default': {
            get: expect.objectContaining({
              responses: expect.objectContaining({
                '200': { description: 'OK' },
                '400': expect.objectContaining({
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/ErrorResponse' },
                    },
                  },
                  description: 'Bad Request',
                }),
                '401': expect.objectContaining({ description: 'Unauthorized' }),
                '403': expect.objectContaining({ description: 'Forbidden' }),
                '404': expect.objectContaining({ description: 'Not Found' }),
                '500': expect.objectContaining({ description: 'Internal Server Error' }),
              }),
            }),
          },
        }),
      }),
    );
  });

  it('preserves explicit @ApiResponse and fills missing default error responses', async () => {
    class CreatedResponse {
      @IsString()
      id = '';
    }

    @Controller('/errors')
    class ErrorsController {
      @ApiResponse(201, { description: 'Created', type: CreatedResponse })
      @ApiResponse(400, { description: 'Custom bad request' })
      @Post('/custom')
      create() {
        return { id: '1' };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: ErrorsController }],
      title: 'Errors API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [ErrorsController],
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
          '/errors/custom': {
            post: expect.objectContaining({
              responses: expect.objectContaining({
                '201': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/CreatedResponse' },
                    },
                  },
                  description: 'Created',
                },
                '400': {
                  description: 'Custom bad request',
                },
                '401': expect.objectContaining({ description: 'Unauthorized' }),
                '403': expect.objectContaining({ description: 'Forbidden' }),
                '404': expect.objectContaining({ description: 'Not Found' }),
                '500': expect.objectContaining({ description: 'Internal Server Error' }),
              }),
            }),
          },
        }),
      }),
    );
  });

  it('resolves injected async options and serves the resulting document', async () => {
    const OPENAPI_TITLE = Symbol('openapi-title');
    const injectedTitles: string[] = [];

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRootAsync({
      inject: [OPENAPI_TITLE],
      useFactory: async (...deps) => {
        const [title] = deps;

        if (typeof title !== 'string') {
          throw new Error('openapi title token must resolve to a string.');
        }

        injectedTitles.push(title);
        await Promise.resolve();

        return {
          sources: [{ controllerToken: HealthController }],
          title,
          version: '2.0.0',
        };
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [HealthController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      providers: [{ provide: OPENAPI_TITLE, useValue: 'Async OpenAPI' }],
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(injectedTitles).toEqual(['Async OpenAPI']);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        info: {
          title: 'Async OpenAPI',
          version: '2.0.0',
        },
      }),
    );
  });

  it('propagates async option factory errors during bootstrap', async () => {
    const openApiModule = OpenApiModule.forRootAsync({
      useFactory: async () => {
        throw new Error('openapi async options failed');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [openApiModule],
    });

    await expect(
      bootstrapApplication({
        mode: 'test',
        rootModule: AppModule,
      }),
    ).rejects.toThrow('openapi async options failed');
  });
});
