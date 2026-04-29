import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import * as corePublicApi from '@fluojs/core';
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from '@fluojs/validation';
import { IntersectionType, OmitType, PartialType, PickType } from '@fluojs/validation';
import * as httpPublicApi from '@fluojs/http';
import { Controller, Get, Post, Produces, Version, createHandlerMapping, type FrameworkRequest, type FrameworkResponse } from '@fluojs/http';
import { FromBody, FromCookie, FromHeader, FromPath, FromQuery, RequestDto } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';

import {
  ApiBearerAuth,
  ApiBody,
  ApiCookie,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTag,
} from './decorators.js';
import * as openApiPublicApi from './index.js';
import { OpenApiModule } from './openapi-module.js';

type TestFrameworkResponse = FrameworkResponse & { body?: unknown };

type TestCloseable = {
  close(signal?: string): Promise<void>;
};

const teardownCallbacks: Array<() => Promise<void>> = [];

function registerAppForCleanup<T extends TestCloseable>(app: T): T {
  teardownCallbacks.push(async () => {
    try {
      await app.close();
    } catch {
      // Cleanup is best-effort because some tests may already close the app while asserting error paths.
    }
  });

  return app;
}

function registerResponseForCleanup<T extends Response>(response: T): T {
  teardownCallbacks.push(async () => {
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup is best-effort because some response bodies are already consumed by assertions.
    }
  });

  return response;
}

async function fetchForTest(...args: Parameters<typeof fetch>): Promise<Response> {
  return registerResponseForCleanup(await fetch(...args));
}

afterEach(async () => {
  while (teardownCallbacks.length > 0) {
    await teardownCallbacks.pop()?.();
  }
});

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

function readRepoTextFile(pathFromRepoRoot: string): string {
  return readFileSync(new URL(`../../../${pathFromRepoRoot}`, import.meta.url), 'utf8');
}

function extractTypeScriptExamples(markdown: string): string[] {
  return [...markdown.matchAll(/```(?:typescript|ts)\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
}

function extractNamedImports(source: string, packageName: string): string[] {
  const importPattern = new RegExp(`^import\\s*{([^}]*)}\\s*from\\s*['"]${packageName}['"];?$`, 'gm');
  const imports: string[] = [];

  for (const match of source.matchAll(importPattern)) {
    const importList = match[1] ?? '';

    for (const specifier of importList.split(',')) {
      const importedName = specifier.trim().split(/\s+as\s+/u)[0]?.trim();

      if (importedName) {
        imports.push(importedName);
      }
    }
  }

  return imports;
}

function expectExamplesToUsePublicExports(markdownPath: string): void {
  const examples = extractTypeScriptExamples(readRepoTextFile(markdownPath));

  expect(examples.length).toBeGreaterThan(0);

  for (const example of examples) {
    expect(example).not.toContain('ApiProperty');

    for (const exportedName of extractNamedImports(example, '@fluojs/openapi')) {
      expect(openApiPublicApi).toHaveProperty(exportedName);
    }

    for (const exportedName of extractNamedImports(example, '@fluojs/http')) {
      expect(httpPublicApi).toHaveProperty(exportedName);
    }

    for (const exportedName of extractNamedImports(example, '@fluojs/core')) {
      expect(corePublicApi).toHaveProperty(exportedName);
    }
  }
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve an available port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

  it('keeps Chapter 10 supported OpenAPI examples aligned with the shipped API surface', async () => {
    expectExamplesToUsePublicExports('book/beginner/ch10-openapi.md');
    expectExamplesToUsePublicExports('book/beginner/ch10-openapi.ko.md');

    class UserListResponse {
      @IsString()
      id = '';
    }

    @ApiTag('Users')
    @Controller('/users')
    class UsersController {
      @ApiOperation({ summary: 'List all users' })
      @ApiResponse(200, { description: 'Success', type: UserListResponse })
      @Produces('application/json')
      @Get('/')
      list() {
        return [{ id: '1' }];
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'My API',
      ui: true,
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({ rootModule: AppModule }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      info: {
        title: 'My API',
        version: '1.0.0',
      },
      openapi: '3.1.0',
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/UserListResponse',
                    },
                  },
                },
                description: 'Success',
              },
            },
            summary: 'List all users',
            tags: ['Users'],
          },
        },
      },
    });
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/docs'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.body).toEqual(expect.stringContaining('https://unpkg.com/swagger-ui-dist@5.32.2/swagger-ui.css'));
    expect(response.body).toEqual(expect.stringContaining('https://unpkg.com/swagger-ui-dist@5.32.2/swagger-ui-bundle.js'));
    expect(response.body).not.toEqual(expect.stringContaining('https://unpkg.com/swagger-ui-dist@5/'));
    expect(response.body).toEqual(expect.stringContaining('const specUrl = window.location.pathname.replace('));
    expect(response.body).toEqual(expect.stringContaining("url: specUrl"));
    expect(response.body).toEqual(expect.stringContaining('SwaggerUIBundle'));
  });

  it('serves prefix-aware Swagger UI when globalPrefix is configured', async () => {
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

    const port = await findAvailablePort();
    const app = registerAppForCleanup(await bootstrapNodeApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      port,
    }));

    await app.listen();

    const [docsResponse, docsTrailingSlashResponse, specResponse, unprefixedSpecResponse] = await Promise.all([
      fetchForTest(`http://127.0.0.1:${String(port)}/api/docs`),
      fetchForTest(`http://127.0.0.1:${String(port)}/api/docs/`),
      fetchForTest(`http://127.0.0.1:${String(port)}/api/openapi.json`),
      fetchForTest(`http://127.0.0.1:${String(port)}/openapi.json`),
    ]);
    const docsHtml = await docsResponse.text();
    const docsTrailingHtml = await docsTrailingSlashResponse.text();

    expect(docsResponse.status).toBe(200);
    expect(docsHtml).toContain('https://unpkg.com/swagger-ui-dist@5.32.2/swagger-ui.css');
    expect(docsHtml).toContain('https://unpkg.com/swagger-ui-dist@5.32.2/swagger-ui-bundle.js');
    expect(docsHtml).toContain('const specUrl = window.location.pathname.replace(');
    expect(docsHtml).toContain('url: specUrl');
    expect(docsTrailingSlashResponse.status).toBe(200);
    expect(docsTrailingHtml).toContain('https://unpkg.com/swagger-ui-dist@5.32.2/swagger-ui.css');
    expect(docsTrailingHtml).toContain('https://unpkg.com/swagger-ui-dist@5.32.2/swagger-ui-bundle.js');
    expect(docsTrailingHtml).toContain('const specUrl = window.location.pathname.replace(');
    expect(docsTrailingHtml).toContain('url: specUrl');
    expect(specResponse.status).toBe(200);
    expect(unprefixedSpecResponse.status).toBe(404);

    await app.close();
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

  it('omits requestBody when request DTO has no body-bound fields', async () => {
    class SearchRequest {
      @FromQuery('q')
      @IsString()
      query = '';

      @IsString()
      unboundHint = '';
    }

    @Controller('/implicit')
    class ImplicitController {
      @RequestDto(SearchRequest)
      @Post('/search')
      search() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: ImplicitController }],
      title: 'Implicit DTO API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [ImplicitController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);

    const document = response.body as {
      paths: Record<string, { post?: { parameters?: unknown[]; requestBody?: unknown } }>;
    };

    expect(document.paths['/implicit/search']?.post?.parameters).toEqual([
      {
        in: 'query',
        name: 'q',
        required: true,
        schema: { type: 'string' },
      },
    ]);
    expect(document.paths['/implicit/search']?.post?.requestBody).toBeUndefined();
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

  it('does not emit nested parameter refs that runtime binding cannot consume', async () => {
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        paths: expect.objectContaining({
          '/search': {
            get: expect.objectContaining({
              parameters: [
                {
                  in: 'query',
                  name: 'filter',
                  required: true,
                  schema: {
                    type: 'string',
                  },
                },
              ],
            }),
          },
        }),
      }),
    );

    const document = response.body as {
      components?: { schemas?: Record<string, unknown> };
    };

    expect(document.components?.schemas?.FilterDto).toBeUndefined();
  });

  it('uses source-aware scalar schemas for path and cookie parameters', async () => {
    class SearchRequest {
      @FromPath('id')
      @IsArray()
      id: string[] = [];

      @FromCookie('session')
      @IsArray()
      session: string[] = [];

      @FromQuery('tags')
      @IsArray()
      tags: string[] = [];

      @FromHeader('x-tags')
      @IsArray()
      headerTags: string[] = [];
    }

    @Controller('/search')
    class SearchController {
      @Get('/:id')
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);

    const document = response.body as {
      paths: Record<string, { get?: { parameters?: Array<{ in: string; name: string; schema: { type?: string } }> } }>;
    };

    expect(document.paths['/search/{id}']?.get?.parameters).toEqual(
      expect.arrayContaining([
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string' },
        },
        {
          in: 'cookie',
          name: 'session',
          required: true,
          schema: { type: 'string' },
        },
        {
          in: 'query',
          name: 'tags',
          required: true,
          schema: { items: {}, type: 'array' },
        },
        {
          in: 'header',
          name: 'x-tags',
          required: true,
          schema: { items: {}, type: 'array' },
        },
      ]),
    );
  });

  it('allows explicit request decorators to override inferred request docs', async () => {
    class UpdateUserRequest {
      @FromPath('id')
      @IsString()
      id = '';

      @FromBody('name')
      @IsString()
      name = '';
    }

    @Controller('/users')
    class UsersController {
      @Post('/:id')
      @RequestDto(UpdateUserRequest)
      @ApiParam('id', { description: 'Numeric user id', schema: { type: 'integer' } })
      @ApiQuery('expand', { schema: { enum: ['profile'], type: 'string' } })
      @ApiHeader('x-request-id', { required: true, schema: { type: 'string' } })
      @ApiCookie('session', { schema: { type: 'string' } })
      @ApiBody({
        description: 'Explicitly documented body',
        required: true,
        schema: {
          properties: {
            displayName: { type: 'string' },
          },
          required: ['displayName'],
          type: 'object',
        },
      })
      updateUser() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'Explicit request docs API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);

    const document = response.body as {
      paths: Record<string, { post?: { parameters?: unknown[]; requestBody?: unknown } }>;
    };
    const operation = document.paths['/users/{id}']?.post;

    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        {
          description: 'Numeric user id',
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'integer' },
        },
        {
          in: 'query',
          name: 'expand',
          schema: { enum: ['profile'], type: 'string' },
        },
        {
          in: 'header',
          name: 'x-request-id',
          required: true,
          schema: { type: 'string' },
        },
        {
          in: 'cookie',
          name: 'session',
          schema: { type: 'string' },
        },
      ]),
    );
    expect(operation?.requestBody).toEqual({
      content: {
        'application/json': {
          schema: {
            properties: {
              displayName: { type: 'string' },
            },
            required: ['displayName'],
            type: 'object',
          },
        },
      },
      description: 'Explicitly documented body',
      required: true,
    });
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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
                error: {
                  additionalProperties: false,
                  properties: {
                    code: { type: 'string' },
                    details: {
                      items: {
                        additionalProperties: false,
                        properties: {
                          code: { type: 'string' },
                          field: { type: 'string' },
                          message: { type: 'string' },
                          source: {
                            enum: ['path', 'query', 'header', 'cookie', 'body'],
                            type: 'string',
                          },
                        },
                        required: ['code', 'message'],
                        type: 'object',
                      },
                      type: 'array',
                    },
                    message: { type: 'string' },
                    meta: {
                      additionalProperties: true,
                      type: 'object',
                    },
                    requestId: { type: 'string' },
                    status: { type: 'integer' },
                  },
                  required: ['code', 'status', 'message'],
                  type: 'object',
                },
              },
              required: ['error'],
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

  it('omits default error response injection when policy is set to omit', async () => {
    @Controller('/errors')
    class ErrorsController {
      @Get('/default')
      defaultHandler() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      defaultErrorResponsesPolicy: 'omit',
      sources: [{ controllerToken: ErrorsController }],
      title: 'Errors API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [ErrorsController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);

    const document = response.body as {
      components?: { schemas?: Record<string, unknown> };
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };

    expect(document.paths['/errors/default']?.get?.responses).toEqual({
      '200': { description: 'OK' },
    });
    expect(document.components?.schemas?.ErrorResponse).toBeUndefined();
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

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
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

  it('avoids component schema key collisions for DTOs with identical constructor names', async () => {
    const makeNamedRequestDto = (name: string) => {
      const generated = {
        [name]: class {
          @FromBody('value')
          @IsString()
          value = '';
        },
      };

      return generated[name] as unknown as new () => { value: string };
    };

    const makeNamedResponseDto = (name: string) => {
      const generated = {
        [name]: class {
          @IsString()
          id = '';
        },
      };

      return generated[name] as unknown as new () => { id: string };
    };

    const SharedRequestDto = makeNamedRequestDto('SharedDto');
    const SharedResponseDto = makeNamedResponseDto('SharedDto');

    @Controller('/collision')
    class CollisionController {
      @RequestDto(SharedRequestDto)
      @ApiResponse(201, { description: 'Created', type: SharedResponseDto })
      @Post('/create')
      create() {
        return { id: '1' };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: CollisionController }],
      title: 'Collision API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [CollisionController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);

    const document = response.body as {
      components: { schemas: Record<string, unknown> };
      paths: Record<string, { post?: { requestBody?: { content?: { 'application/json'?: { schema?: { $ref?: string } } } }; responses?: Record<string, { content?: { 'application/json'?: { schema?: { $ref?: string } } } }> } }>;
    };

    const requestSchemaRef = document.paths['/collision/create']?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
    const responseSchemaRef = document.paths['/collision/create']?.post?.responses?.['201']?.content?.['application/json']?.schema?.$ref;

    expect(requestSchemaRef).toBeDefined();
    expect(responseSchemaRef).toBeDefined();
    expect(requestSchemaRef).not.toBe(responseSchemaRef);

    const requestSchemaName = requestSchemaRef?.replace('#/components/schemas/', '');
    const responseSchemaName = responseSchemaRef?.replace('#/components/schemas/', '');

    expect(requestSchemaName).toBeDefined();
    expect(responseSchemaName).toBeDefined();
    expect(document.components.schemas[requestSchemaName as string]).toBeDefined();
    expect(document.components.schemas[responseSchemaName as string]).toBeDefined();
  });

  it('keeps default ErrorResponse schema reserved when a DTO shares the same name', async () => {
    const makeNamedRequestDto = (name: string) => {
      const generated = {
        [name]: class {
          @FromBody('message')
          @IsString()
          message = '';
        },
      };

      return generated[name] as unknown as new () => { message: string };
    };

    const ErrorResponseRequestDto = makeNamedRequestDto('ErrorResponse');

    @Controller('/reserved')
    class ReservedNameController {
      @RequestDto(ErrorResponseRequestDto)
      @Post('/create')
      create() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: ReservedNameController }],
      title: 'Reserved Name API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [ReservedNameController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({
      rootModule: AppModule,
    }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);

    const document = response.body as {
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
      paths: Record<string, { post?: { requestBody?: { content?: { 'application/json'?: { schema?: { $ref?: string } } } }; responses?: Record<string, { content?: { 'application/json'?: { schema?: { $ref?: string } } } }> } }>;
    };

    const requestSchemaRef = document.paths['/reserved/create']?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
    const defaultErrorSchemaRef = document.paths['/reserved/create']?.post?.responses?.['400']?.content?.['application/json']?.schema?.$ref;

    expect(requestSchemaRef).toBeDefined();
    expect(defaultErrorSchemaRef).toBe('#/components/schemas/ErrorResponse');
    expect(requestSchemaRef).not.toBe(defaultErrorSchemaRef);

    const requestSchemaName = requestSchemaRef?.replace('#/components/schemas/', '');
    expect(requestSchemaName).toBeDefined();
    expect(requestSchemaName).not.toBe('ErrorResponse');
    expect(document.components.schemas[requestSchemaName as string]?.properties?.message?.type).toBe('string');
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

    const app = registerAppForCleanup(await bootstrapApplication({
      providers: [{ provide: OPENAPI_TITLE, useValue: 'Async OpenAPI' }],
      rootModule: AppModule,
    }));
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

  it('forRoot options support custom security schemes, extraModels, and excluded endpoints', async () => {
    class ExtraModel {
      @IsString()
      name = '';
    }

    @Controller('/admin')
    class AdminController {
      @ApiOperation({ deprecated: true, summary: 'Visible' })
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

    const openApiModule = OpenApiModule.forRoot({
      extraModels: [ExtraModel],
      securitySchemes: {
        apiKeyAuth: {
          in: 'header',
          name: 'x-api-key',
          type: 'apiKey',
        },
      },
      sources: [{ controllerToken: AdminController }],
      title: 'Admin API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [AdminController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({ rootModule: AppModule }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          schemas: expect.objectContaining({
            ExtraModel: {
              additionalProperties: false,
              properties: {
                name: {
                  type: 'string',
                },
              },
              required: ['name'],
              type: 'object',
            },
          }),
          securitySchemes: {
            apiKeyAuth: {
              in: 'header',
              name: 'x-api-key',
              type: 'apiKey',
            },
          },
        }),
        paths: {
          '/admin/visible': {
            get: expect.objectContaining({
              deprecated: true,
              security: [{ apiKeyAuth: [] }],
            }),
          },
        },
      }),
    );

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(paths['/admin/internal']).toBeUndefined();
  });

  it('forRoot composes descriptors and sources when both are provided', async () => {
    @Controller('/from-sources')
    class SourcesController {
      @Get('/')
      getSources() {
        return { from: 'sources' };
      }
    }

    @Controller('/from-descriptors')
    class DescriptorsController {
      @Get('/')
      getDescriptors() {
        return { from: 'descriptors' };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      descriptors: createHandlerMapping([{ controllerToken: DescriptorsController }]).descriptors,
      sources: [{ controllerToken: SourcesController }],
      title: 'Composed API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [SourcesController, DescriptorsController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({ rootModule: AppModule }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        paths: expect.objectContaining({
          '/from-sources': expect.objectContaining({
            get: expect.any(Object),
          }),
          '/from-descriptors': expect.objectContaining({
            get: expect.any(Object),
          }),
        }),
      }),
    );
  });

  it('README quick start stays executable when sources are provided explicitly', async () => {
    @ApiTag('Users')
    @Controller('/users')
    class UsersController {
      @ApiOperation({ summary: 'List all users' })
      @ApiResponse(200, { description: 'Success' })
      @Get('/')
      list() {
        return [];
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      sources: [{ controllerToken: UsersController }],
      title: 'My API',
      version: '1.0.0',
      ui: true,
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({ rootModule: AppModule }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        info: {
          title: 'My API',
          version: '1.0.0',
        },
        paths: expect.objectContaining({
          '/users': expect.objectContaining({
            get: expect.any(Object),
          }),
        }),
      }),
    );
  });

  it('forRootAsync composes descriptors and sources when both are provided', async () => {
    @Controller('/async-sources')
    class AsyncSourcesController {
      @Get('/')
      getSources() {
        return { from: 'sources' };
      }
    }

    @Controller('/async-descriptors')
    class AsyncDescriptorsController {
      @Get('/')
      getDescriptors() {
        return { from: 'descriptors' };
      }
    }

    const openApiModule = OpenApiModule.forRootAsync({
      useFactory: async () => ({
        descriptors: createHandlerMapping([{ controllerToken: AsyncDescriptorsController }]).descriptors,
        sources: [{ controllerToken: AsyncSourcesController }],
        title: 'Async Composed API',
        version: '1.0.0',
      }),
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [AsyncSourcesController, AsyncDescriptorsController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({ rootModule: AppModule }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        info: {
          title: 'Async Composed API',
          version: '1.0.0',
        },
        paths: expect.objectContaining({
          '/async-sources': expect.objectContaining({
            get: expect.any(Object),
          }),
          '/async-descriptors': expect.objectContaining({
            get: expect.any(Object),
          }),
        }),
      }),
    );
  });

  it('forRoot options apply documentTransform after document generation', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    const openApiModule = OpenApiModule.forRoot({
      documentTransform: (document) => ({
        ...document,
        info: {
          ...document.info,
          title: `${document.info.title} (Transformed)`,
        },
      }),
      sources: [{ controllerToken: HealthController }],
      title: 'Health API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [HealthController],
      imports: [openApiModule],
    });

    const app = registerAppForCleanup(await bootstrapApplication({ rootModule: AppModule }));
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        info: {
          title: 'Health API (Transformed)',
          version: '1.0.0',
        },
        paths: expect.objectContaining({
          '/health': expect.objectContaining({
            get: expect.any(Object),
          }),
        }),
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
        rootModule: AppModule,
      }),
    ).rejects.toThrow('openapi async options failed');
  });
});
