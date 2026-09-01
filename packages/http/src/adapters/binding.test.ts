import type { Token } from '@fluojs/core';
import { Container, type RequestScopeContainer } from '@fluojs/di';
import {
  ArrayMinSize,
  DefaultValidator as BaseDefaultValidator,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from '@fluojs/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Convert,
  FromBody,
  FromCookie,
  FromFiles,
  FromHeader,
  FromPath,
  FromQuery,
  Optional,
} from '../decorators.js';
import type {
  ArgumentResolverContext,
  FrameworkRequest,
  FrameworkRequestFile,
  FrameworkResponse,
} from '../types.js';
import { DefaultBinder } from './binding.js';
import { getCompiledDtoBindingPlan } from './dto-binding-plan.js';
import { HttpDtoValidationAdapter } from './dto-validation-adapter.js';

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

afterEach(() => {
  vi.restoreAllMocks();
});

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

function createContext(
  request: FrameworkRequest,
  resolve: <T>(token: Token<T>) => Promise<T> = async () => {
    throw new Error('not used');
  },
  has: (token: Token) => boolean = () => false,
): ArgumentResolverContext {
  const container: RequestScopeContainer & { has(token: Token): boolean } = {
    async dispose() {
      return undefined;
    },
    has,
    async resolve(token) {
      return resolve(token);
    },
  };

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
      container,
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
    ).rejects.toMatchObject({
      details: [
        {
          code: 'DANGEROUS_KEY',
          field: '__proto__',
          message: 'Dangerous body key __proto__ is not allowed.',
          source: 'body',
        },
        {
          code: 'UNKNOWN_FIELD',
          field: 'extra',
          message: 'Unknown body field extra.',
          source: 'body',
        },
      ],
      status: 400,
    });
  });

  it('binds header and cookie fields while preserving symbol property keys', async () => {
    const sessionToken = Symbol('sessionToken');

    class AuthenticatedRequest {
      @FromHeader('x-request-id')
      requestId = '';

      @FromCookie('session')
      [sessionToken] = '';

      @FromBody('nickname')
      @Optional()
      nickname?: string;
    }

    const binder = new DefaultBinder();
    const bound = (await binder.bind(
      AuthenticatedRequest,
      createContext(
        createRequest({
          body: {},
          cookies: { session: 'cookie-123' },
          headers: { 'x-request-id': 'req-123' },
        }),
      ),
    )) as AuthenticatedRequest;

    expect(bound.requestId).toBe('req-123');
    expect(bound[sessionToken]).toBe('cookie-123');
    expect(bound.nickname).toBeUndefined();
  });

  it('binds header fields case-insensitively while preserving multi-value arrays', async () => {
    class HeaderBoundRequest {
      @FromHeader('x-request-id')
      requestId = '';

      @FromHeader('x-role')
      roles: string[] = [];
    }

    const binder = new DefaultBinder();
    const bound = (await binder.bind(
      HeaderBoundRequest,
      createContext(
        createRequest({
          headers: {
            'X-Request-Id': 'req-123',
            'X-Role': ['admin', 'editor'],
          },
        }),
      ),
    )) as HeaderBoundRequest;

    expect(bound.requestId).toBe('req-123');
    expect(bound.roles).toEqual(['admin', 'editor']);
  });

  it('preserves single-element arrays for query bindings', async () => {
    class SearchUsersRequest {
      @FromQuery('tag')
      tags: string[] = [];
    }

    const binder = new DefaultBinder();
    const bound = (await binder.bind(
      SearchUsersRequest,
      createContext(createRequest({ query: { tag: ['admin'] } })),
    )) as SearchUsersRequest;

    expect(bound.tags).toEqual(['admin']);
  });

  it('binds filtered portable file arrays in adapter order without native leakage', async () => {
    const attachments = [
      {
        buffer: new Uint8Array([1]),
        fieldname: 'attachments',
        mimetype: 'text/plain',
        nativeUpload: { stream: 'native-only' },
        originalname: 'first.txt',
        size: 1,
      },
      {
        buffer: new Uint8Array([2]),
        fieldname: 'cover',
        mimetype: 'text/plain',
        nativeUpload: { stream: 'native-only' },
        originalname: 'cover.txt',
        size: 1,
      },
      {
        buffer: new Uint8Array([3]),
        fieldname: 'attachments',
        mimetype: 'text/plain',
        nativeUpload: { stream: 'native-only' },
        originalname: 'second.txt',
        size: 1,
      },
    ] satisfies readonly (FrameworkRequestFile & { nativeUpload: { stream: string } })[];

    class UploadRequest {
      @FromFiles('attachments')
      attachments: readonly FrameworkRequestFile[] = [];
    }

    const request = createRequest({ files: attachments });
    const binder = new DefaultBinder();
    const bound = (await binder.bind(UploadRequest, createContext(request))) as UploadRequest;

    expect(bound.attachments.map((file) => file.originalname)).toEqual(['first.txt', 'second.txt']);
    expect(bound.attachments[0]).not.toBe(attachments[0]);
    expect(bound.attachments[0]).toEqual({
      buffer: new Uint8Array([1]),
      fieldname: 'attachments',
      mimetype: 'text/plain',
      originalname: 'first.txt',
      size: 1,
    });
    expect(bound.attachments[0]).not.toHaveProperty('nativeUpload');
    expect(request.files?.[0]).toBe(attachments[0]);
  });

  it('distinguishes absent files from present unmatched fields and supports Optional', async () => {
    class RequiredUploadRequest {
      @FromFiles('attachments')
      attachments: readonly FrameworkRequestFile[] = [];
    }

    class OptionalUploadRequest {
      @FromFiles('attachments')
      @Optional()
      attachments?: readonly FrameworkRequestFile[];
    }

    const binder = new DefaultBinder();

    await expect(
      binder.bind(RequiredUploadRequest, createContext(createRequest())),
    ).rejects.toMatchObject({
      details: [
        {
          code: 'MISSING_FIELD',
          field: 'attachments',
          source: 'files',
        },
      ],
      status: 400,
    });

    const absent = (await binder.bind(
      OptionalUploadRequest,
      createContext(createRequest()),
    )) as OptionalUploadRequest;
    const unmatched = (await binder.bind(
      OptionalUploadRequest,
      createContext(
        createRequest({
          files: [
            {
              buffer: new Uint8Array([1]),
              fieldname: 'cover',
              mimetype: 'text/plain',
              originalname: 'cover.txt',
              size: 1,
            },
          ],
        }),
      ),
    )) as OptionalUploadRequest;

    expect(absent.attachments).toBeUndefined();
    expect(unmatched.attachments).toEqual([]);
  });

  it('applies converters to portable file arrays', async () => {
    class FileNameConverter {
      convert(value: unknown, target: { source: string }) {
        expect(target.source).toBe('files');
        return (value as readonly FrameworkRequestFile[]).map((file) => file.originalname);
      }
    }

    class UploadRequest {
      @FromFiles('attachments')
      @Convert(FileNameConverter)
      filenames: string[] = [];
    }

    const binder = new DefaultBinder();
    const bound = (await binder.bind(
      UploadRequest,
      createContext(
        createRequest({
          files: [
            {
              buffer: new Uint8Array([1]),
              fieldname: 'attachments',
              mimetype: 'text/plain',
              originalname: 'first.txt',
              size: 1,
            },
          ],
        }),
      ),
    )) as UploadRequest;

    expect(bound.filenames).toEqual(['first.txt']);
  });

  it('applies global converters before assigning DTO fields', async () => {
    class QueryNumberConverter {
      convert(value: unknown, target: { source: string }) {
        if (target.source === 'query' && typeof value === 'string') {
          return Number(value);
        }

        return value;
      }
    }

    class SearchUsersRequest {
      @FromQuery('id')
      id = 0;
    }

    const binder = new DefaultBinder([QueryNumberConverter]);
    const bound = (await binder.bind(
      SearchUsersRequest,
      createContext(createRequest({ query: { id: '42' } })),
    )) as SearchUsersRequest;

    expect(bound.id).toBe(42);
  });

  it('applies field-level converters for bound DTO members', async () => {
    class TrimStringConverter {
      convert(value: unknown) {
        return typeof value === 'string' ? value.trim() : value;
      }
    }

    class CreateUserRequest {
      @FromBody('name')
      @Convert(TrimStringConverter)
      name = '';
    }

    const binder = new DefaultBinder();
    const bound = (await binder.bind(
      CreateUserRequest,
      createContext(createRequest({ body: { name: '  Ada  ' } })),
    )) as CreateUserRequest;

    expect(bound.name).toBe('Ada');
  });

  it('applies field-level converters after global converters', async () => {
    class GlobalPrefixConverter {
      convert(value: unknown) {
        return typeof value === 'string' ? `global:${value}` : value;
      }
    }

    class FieldPrefixConverter {
      convert(value: unknown) {
        return typeof value === 'string' ? `field:${value}` : value;
      }
    }

    class CreateUserRequest {
      @FromBody('name')
      @Convert(FieldPrefixConverter)
      name = '';
    }

    const binder = new DefaultBinder([new GlobalPrefixConverter()]);
    const bound = (await binder.bind(
      CreateUserRequest,
      createContext(createRequest({ body: { name: 'Ada' } })),
    )) as CreateUserRequest;

    expect(bound.name).toBe('field:global:Ada');
  });

  it('reuses compiled DTO binding plans without reusing request-scoped converters', async () => {
    const requestScopedConverter = Symbol('requestScopedConverter');

    class SearchUsersRequest {
      @FromQuery('id')
      id = '';
    }

    const binder = new DefaultBinder([requestScopedConverter]);
    const plan = getCompiledDtoBindingPlan(SearchUsersRequest);

    expect(getCompiledDtoBindingPlan(SearchUsersRequest)).toBe(plan);

    const resolveCalls: string[] = [];
    const createRequestScopedContext = (prefix: string) =>
      createContext(createRequest({ query: { id: '42' } }), async <T>(token: Token<T>) => {
        expect(token).toBe(requestScopedConverter);
        resolveCalls.push(prefix);
        return {
          convert(value: unknown) {
            return `${prefix}:${String(value)}`;
          },
        } as T;
      });

    const first = (await binder.bind(SearchUsersRequest, createRequestScopedContext('first'))) as SearchUsersRequest;
    const second = (await binder.bind(SearchUsersRequest, createRequestScopedContext('second'))) as SearchUsersRequest;

    expect(first.id).toBe('first:42');
    expect(second.id).toBe('second:42');
    expect(resolveCalls).toEqual(['first', 'second']);
  });

  it('propagates registered converter provider failures without direct construction', async () => {
    // Given
    let constructorCalls = 0;
    const providerFailure = new Error('registered converter failed');

    class RegisteredConverter {
      constructor() {
        constructorCalls += 1;
      }

      convert(value: unknown) {
        return value;
      }
    }

    class SearchUsersRequest {
      @FromQuery('id')
      id = '';
    }

    const binder = new DefaultBinder([RegisteredConverter]);

    // When
    const binding = binder.bind(
      SearchUsersRequest,
      createContext(createRequest({ query: { id: '42' } }), async <T>(token: Token<T>) => {
        expect(token).toBe(RegisteredConverter);
        throw providerFailure;
      }, (token) => token === RegisteredConverter),
    );

    // Then
    await expect(binding).rejects.toBe(providerFailure);
    expect(constructorCalls).toBe(0);
  });

  it('resolves class converters through request facades without registration checks', async () => {
    // Given
    const directConstructionFailure = new Error('must resolve through the facade');
    const resolvedConverter = {
      convert(value: unknown) {
        return `resolved:${String(value)}`;
      },
    };

    class FacadeConverter {
      constructor() {
        throw directConstructionFailure;
      }

      convert(value: unknown) {
        return value;
      }
    }

    class SearchUsersRequest {
      @FromQuery('id')
      id = '';
    }

    const context = createContext(
      createRequest({ query: { id: '42' } }),
      async <T>(token: Token<T>) => {
        expect(token).toBe(FacadeConverter);
        return resolvedConverter as T;
      },
    );
    const resolve = context.requestContext.container.resolve.bind(context.requestContext.container);
    const container: RequestScopeContainer = {
      async dispose() {
        return undefined;
      },
      async resolve<T>(token: Token<T>) {
        return resolve(token);
      },
    };
    context.requestContext.container = container;
    const binder = new DefaultBinder([FacadeConverter]);

    // When
    const bound = (await binder.bind(SearchUsersRequest, context)) as SearchUsersRequest;

    // Then
    expect(bound.id).toBe('resolved:42');
  });

  it('directly constructs explicitly unregistered converter classes', async () => {
    // Given
    let constructorCalls = 0;

    class UnregisteredConverter {
      constructor() {
        constructorCalls += 1;
      }

      convert(value: unknown) {
        return Number(value);
      }
    }

    class SearchUsersRequest {
      @FromQuery('id')
      id = 0;
    }

    const binder = new DefaultBinder([UnregisteredConverter]);

    // When
    const bound = (await binder.bind(
      SearchUsersRequest,
      createContext(createRequest({ query: { id: '42' } })),
    )) as SearchUsersRequest;

    // Then
    expect(bound.id).toBe(42);
    expect(constructorCalls).toBe(1);
  });

  it('uses the request container for request-scoped converter disposal', async () => {
    // Given
    const disposalEvents: string[] = [];

    class RequestScopedConverter {
      convert(value: unknown) {
        return `converted:${String(value)}`;
      }

      onDestroy() {
        disposalEvents.push('destroyed');
      }
    }

    class SearchUsersRequest {
      @FromQuery('id')
      id = '';
    }

    const root = new Container().register({
      provide: RequestScopedConverter,
      scope: 'request',
      useClass: RequestScopedConverter,
    });
    const requestScope = root.createRequestScope();
    const binder = new DefaultBinder([RequestScopedConverter]);
    const context = createContext(createRequest({ query: { id: '42' } }));
    context.requestContext.container = requestScope;

    // When
    const bound = (await binder.bind(SearchUsersRequest, context)) as SearchUsersRequest;
    await requestScope.dispose();

    // Then
    expect(bound.id).toBe('converted:42');
    expect(disposalEvents).toEqual(['destroyed']);
  });
});

describe('HttpDtoValidationAdapter', () => {
  it('validates matched file arrays after binding', async () => {
    class UploadRequest {
      @FromFiles('attachments')
      @ArrayMinSize(1)
      attachments: readonly FrameworkRequestFile[] = [];
    }

    const binder = new DefaultBinder();
    const validator = new HttpDtoValidationAdapter();
    const bound = (await binder.bind(
      UploadRequest,
      createContext(
        createRequest({
          files: [
            {
              buffer: new Uint8Array([1]),
              fieldname: 'cover',
              mimetype: 'text/plain',
              originalname: 'cover.txt',
              size: 1,
            },
          ],
        }),
      ),
    )) as UploadRequest;

    await expect(validator.validate(bound, UploadRequest)).rejects.toMatchObject({
      details: [
        {
          field: 'attachments',
          source: 'files',
        },
      ],
      status: 400,
    });
  });

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

  it('forwards strict materialization options to the validation engine', async () => {
    // Given
    class CreateUserRequest {
      @FromBody('name')
      @IsString()
      name = '';
    }

    const validator = new HttpDtoValidationAdapter();

    // When
    const result = validator.materialize(
      { extra: true, name: 'Ada' },
      CreateUserRequest,
      { undeclaredProperties: 'reject' },
    );

    // Then
    await expect(result).rejects.toMatchObject({
      details: [
        {
          code: 'UNDECLARED_PROPERTY',
          field: 'extra',
          message: 'extra is not declared by the DTO.',
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
      @ValidateIf((dto: unknown) => Boolean((dto as PasswordResetRequest).enabled))
      @MinLength(8, { message: 'password must have length at least 8' })
      password = '';

      @FromBody('nickname')
      @IsOptional()
      @IsString()
      nickname?: string;

      @FromBody('enabled')
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

  it('validates only bound DTO properties in HTTP RequestDto flow', async () => {
    class SearchRequest {
      @FromQuery('q')
      @IsString()
      @MinLength(1, { code: 'QUERY_REQUIRED', message: 'q is required' })
      query = '';

      @IsString()
      @MinLength(1, { code: 'UNBOUND_REQUIRED', message: 'unbound hint is required' })
      unboundHint = '';
    }

    const validator = new HttpDtoValidationAdapter();

    await expect(
      validator.validate(
        Object.assign(new SearchRequest(), {
          query: 'fluo',
          unboundHint: '',
        }),
        SearchRequest,
      ),
    ).resolves.toBeUndefined();

    await expect(
      validator.validate(
        Object.assign(new SearchRequest(), {
          query: '',
          unboundHint: '',
        }),
        SearchRequest,
      ),
    ).rejects.toMatchObject({
      details: [
        {
          code: 'QUERY_REQUIRED',
          field: 'query',
          message: 'q is required',
          source: 'query',
        },
      ],
      status: 400,
    });
  });

  it('skips validation engine work when a RequestDto has no validation rules', async () => {
    class SearchRequest {
      @FromQuery('q')
      query = '';
    }

    const validateSpy = vi.spyOn(BaseDefaultValidator.prototype, 'validate');
    const validator = new HttpDtoValidationAdapter();

    await expect(
      validator.validate(
        Object.assign(new SearchRequest(), {
          query: 'fluo',
        }),
        SearchRequest,
      ),
    ).resolves.toBeUndefined();

    expect(validateSpy).not.toHaveBeenCalled();
  });

  it('reuses the bound DTO instance for simple bound-field validation rules', async () => {
    class SearchRequest {
      @FromQuery('q')
      @IsString()
      @MinLength(1, { code: 'QUERY_REQUIRED', message: 'q is required' })
      query = '';
    }

    const validateSpy = vi.spyOn(BaseDefaultValidator.prototype, 'validate');
    const validator = new HttpDtoValidationAdapter();
    const input = Object.assign(new SearchRequest(), {
      query: 'fluo',
    });

    await expect(validator.validate(input, SearchRequest)).resolves.toBeUndefined();

    expect(validateSpy).toHaveBeenCalledOnce();
    expect(validateSpy.mock.calls[0]?.[0]).toBe(input);
    expect(validateSpy.mock.calls[0]?.[1]).toBe(SearchRequest);
  });

  it('filters unbound DTO state before running ValidateIf rules', async () => {
    class SearchRequest {
      @FromQuery('q')
      @ValidateIf((dto: unknown) => Boolean((dto as SearchRequest).enabled))
      @MinLength(2, { code: 'QUERY_TOO_SHORT', message: 'q must have length at least 2' })
      query = '';

      enabled = false;
    }

    const validateSpy = vi.spyOn(BaseDefaultValidator.prototype, 'validate');
    const validator = new HttpDtoValidationAdapter();
    const input = Object.assign(new SearchRequest(), {
      enabled: true,
      query: '',
    });

    await expect(validator.validate(input, SearchRequest)).resolves.toBeUndefined();

    expect(validateSpy).toHaveBeenCalledOnce();
    expect(validateSpy.mock.calls[0]?.[0]).not.toBe(input);
  });

  it('preserves symbol-backed bound fields while filtering unbound validation properties', async () => {
    const sessionToken = Symbol('sessionToken');

    class SymbolBackedRequest {
      @FromBody('session')
      @MinLength(4, { code: 'SESSION_REQUIRED', message: 'session token is required' })
      [sessionToken] = '';

      @MinLength(1, { code: 'UNBOUND_REQUIRED', message: 'unbound hint is required' })
      unboundHint = '';
    }

    const validator = new HttpDtoValidationAdapter();

    await expect(
      validator.validate(
        Object.assign(new SymbolBackedRequest(), {
          [sessionToken]: 'abcd',
          unboundHint: '',
        }),
        SymbolBackedRequest,
      ),
    ).resolves.toBeUndefined();

    await expect(
      validator.validate(
        Object.assign(new SymbolBackedRequest(), {
          [sessionToken]: '',
          unboundHint: '',
        }),
        SymbolBackedRequest,
      ),
    ).rejects.toMatchObject({
      details: [
        {
          code: 'SESSION_REQUIRED',
          field: String(sessionToken),
          message: 'session token is required',
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
