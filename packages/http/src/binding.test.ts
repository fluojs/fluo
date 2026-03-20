import { describe, expect, it } from 'vitest';

import {
  FromBody,
  FromPath,
  Optional,
} from './decorators.js';
import {
  ArrayMinSize,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from '@konekti/dto-validator';
import { BadRequestException } from './exceptions.js';
import { DefaultBinder } from './binding.js';
import { HttpDtoValidationAdapter } from './dto-validation-adapter.js';
import type { ArgumentResolverContext, FrameworkRequest, FrameworkResponse } from './types.js';

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
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
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
        async dispose() {},
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

describe('HttpDtoValidationAdapter', () => {
  it('uses DTO decorator validation rules and raises bad request details', async () => {
    class CreateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'name is required' })
      name = '';
    }

    const validator = new HttpDtoValidationAdapter();

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

  it('supports validator-style email and array decorators', async () => {
    class CreateInviteRequest {
      @FromBody('email')
      @IsEmail({ message: 'email must be valid' })
      email = '';

      @FromBody('roles')
      @ArrayMinSize(1, { message: 'roles must contain at least one entry' })
      roles: string[] = [];
    }

    const validator = new HttpDtoValidationAdapter();

    await expect(
      validator.validate(
        Object.assign(new CreateInviteRequest(), {
          email: 'not-an-email',
          roles: [],
        }),
        CreateInviteRequest,
      ),
    ).rejects.toMatchObject({
      details: [
        {
          code: 'EMAIL',
          field: 'email',
          message: 'email must be valid',
          source: 'body',
        },
        {
          code: 'ARRAY_MIN_SIZE',
          field: 'roles',
          message: 'roles must contain at least one entry',
          source: 'body',
        },
      ],
      status: 400,
    });
  });

  it('supports conditional and optional validator decorators', async () => {
    class PasswordResetRequest {
      @FromBody('password')
      @ValidateIf((dto) => Boolean((dto as { enabled?: boolean }).enabled))
      @MinLength(8, { message: 'password must have length at least 8' })
      password = '';

      @FromBody('nickname')
      @IsOptional()
      @IsString()
      nickname?: string;

      enabled = false;
    }

    const validator = new HttpDtoValidationAdapter();

    await expect(
      validator.validate(
        Object.assign(new PasswordResetRequest(), {
          enabled: false,
          nickname: undefined,
          password: '',
        }),
        PasswordResetRequest,
      ),
    ).resolves.toBeUndefined();

    await expect(
      validator.validate(
        Object.assign(new PasswordResetRequest(), {
          enabled: true,
          password: 'short',
        }),
        PasswordResetRequest,
      ),
    ).rejects.toMatchObject({
      details: [
        {
          code: 'MIN_LENGTH',
          field: 'password',
          message: 'password must have length at least 8',
          source: 'body',
        },
      ],
      status: 400,
    });
  });

  it('supports nested DTO validation, each semantics, and nested field paths', async () => {
    class AddressDto {
      @MinLength(1, { code: 'REQUIRED_CITY', message: 'city is required' })
      city = '';
    }

    class ItemDto {
      @MinLength(2, { message: 'item name must have length at least 2' })
      name = '';
    }

    class CreateOrderRequest {
      @FromBody('address')
      @ValidateNested(() => AddressDto)
      address = new AddressDto();

      @FromBody('tags')
      @MinLength(2, { each: true, message: 'tag must have length at least 2' })
      tags: string[] = [];

      @FromBody('items')
      @ValidateNested(() => ItemDto, { each: true })
      items: ItemDto[] = [];
    }

    const validator = new HttpDtoValidationAdapter();

    await expect(
      validator.validate(
        Object.assign(new CreateOrderRequest(), {
          address: { city: '' },
          items: [{ name: '' }],
          tags: ['ok', 'x'],
        }),
        CreateOrderRequest,
      ),
    ).rejects.toMatchObject({
      details: [
        {
          code: 'REQUIRED_CITY',
          field: 'address.city',
          message: 'city is required',
          source: 'body',
        },
        {
          code: 'MIN_LENGTH',
          field: 'tags[1]',
          message: 'tag must have length at least 2',
          source: 'body',
        },
        {
          code: 'MIN_LENGTH',
          field: 'items[0].name',
          message: 'item name must have length at least 2',
          source: 'body',
        },
      ],
      status: 400,
    });
  });
});
