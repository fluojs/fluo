import { describe, expect, it } from 'vitest';

import { FromBody, FromPath, Optional } from './decorators';
import { BadRequestException } from './exceptions';
import { DefaultBinder } from './binding';
import type { ArgumentResolverContext, FrameworkRequest, FrameworkResponse, ValidationIssue } from './types';
import { DefaultValidator } from './validation';

function createRequest(overrides: Partial<FrameworkRequest> = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'POST',
    params: {},
    path: '/users',
    query: {},
    raw: {},
    url: '/users',
    ...overrides,
  };
}

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
    },
    statusCode: 200,
  };
}

function createContext(request: FrameworkRequest): ArgumentResolverContext {
  return {
    handler: {
      controllerToken: class ExampleController {},
      metadata: {
        controllerPath: '/users',
        effectivePath: '/users/:id',
        moduleMiddleware: [],
        pathParams: ['id'],
      },
      methodName: 'create',
      route: {
        method: 'POST',
        path: '/users/:id',
        request: undefined,
      },
    },
    requestContext: {
      container: {
        resolve() {
          throw new Error('not used');
        },
      },
      metadata: {},
      request,
      response: createResponse(),
    },
  };
}

describe('DefaultBinder', () => {
  it('binds explicit path/body fields into a DTO instance', async () => {
    class CreateUserRequest {
      @FromPath('id')
      id = '';

      @FromBody('name')
      name = '';

      @FromBody('nickname')
      @Optional()
      nickname?: string;
    }

    const binder = new DefaultBinder();
    const bound = (await binder.bind(
      CreateUserRequest,
      createContext(createRequest({ body: { name: 'Ada' }, params: { id: 'user-1' } })),
    )) as CreateUserRequest;

    expect(bound).toBeInstanceOf(CreateUserRequest);
    expect(bound).toEqual({
      id: 'user-1',
      name: 'Ada',
    });
  });

  it('rejects unknown and dangerous body keys', async () => {
    class CreateUserRequest {
      @FromBody('name')
      name = '';
    }

    const binder = new DefaultBinder();

    await expect(
      binder.bind(
        CreateUserRequest,
        createContext(
          createRequest({
            body: {
              ['__proto__']: 'boom',
              extra: true,
              name: 'Ada',
            },
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DefaultValidator', () => {
  it('uses DTO static validation adapters and raises bad request details', async () => {
    class CreateUserRequest {
      static validator = {
        validate(value: CreateUserRequest): ValidationIssue[] {
          if (value.name.length > 0) {
            return [];
          }

          return [
            {
              code: 'REQUIRED',
              field: 'name',
              message: 'name is required',
              source: 'body',
            },
          ];
        },
      };

      name = '';
    }

    const validator = new DefaultValidator();

    await expect(validator.validate(new CreateUserRequest(), CreateUserRequest)).rejects.toMatchObject({
      details: [
        {
          code: 'REQUIRED',
          field: 'name',
          message: 'name is required',
          source: 'body',
        },
      ],
      status: 400,
    });
  });
});
