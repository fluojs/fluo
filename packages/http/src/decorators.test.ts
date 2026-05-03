import { describe, expect, it, vi } from 'vitest';

import {
  getClassValidationRules,
  getControllerMetadata,
  getDtoBindingSchema,
  getDtoValidationSchema,
  getRouteMetadata,
} from '@fluojs/core/internal';

import {
  Convert,
  Controller,
  FromBody,
  FromPath,
  FromQuery,
  Get,
  Header,
  Optional,
  Produces,
  RequestDto,
  HttpCode,
  Redirect,
  UseGuards,
  UseInterceptors,
  Version,
  getRouteProducesMetadata,
} from './decorators.js';
import { InvalidRoutePathError } from './errors.js';
import { IntersectionType, OmitType, PartialType, PickType } from '@fluojs/validation';
import { IsString, MinLength, ValidateClass } from '@fluojs/validation';

class NoopTestConverter {
  convert(value: unknown) {
    return value;
  }
}

type LegacyClassDecoratorFn = (target: Function) => void;
type LegacyMethodDecoratorFn = (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => void;
type LegacyFieldDecoratorFn = (target: object, propertyKey: string | symbol) => void;

describe('http decorators', () => {
  it('writes controller and route metadata using decorator syntax', () => {
    class ClassGuard {
      canActivate() {}
    }

    class MethodGuard {
      canActivate() {}
    }

    class ClassInterceptor {
      intercept(_context: unknown, next: { handle(): Promise<unknown> }) {
        return next.handle();
      }
    }

    class MethodInterceptor {
      intercept(_context: unknown, next: { handle(): Promise<unknown> }) {
        return next.handle();
      }
    }

    class GetUserRequest {
      @FromPath('id')
      id = '';

      @FromBody('note')
      @Convert(NoopTestConverter)
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'note is required' })
      @Optional()
      note?: string;
    }

    @ValidateClass((value: unknown) => {
      const count = typeof value === 'object' && value !== null && 'requestCount' in value
        ? (value as { requestCount?: number }).requestCount
        : undefined;

      return typeof count === 'number' && count > 0 || {
        code: 'REQUIRED',
        field: 'requestCount',
        message: 'requestCount is required',
      };
    })
    @Controller('/users')
    @UseGuards(ClassGuard)
    @UseInterceptors(ClassInterceptor)
    class ExampleController {
      requestCount = 1;

      @RequestDto(GetUserRequest)
      @HttpCode(200)
      @Get('/:id')
      @UseGuards(MethodGuard)
      @UseInterceptors(MethodInterceptor)
      getUser() {
        return { ok: true };
      }
    }

    expect(getControllerMetadata(ExampleController)).toEqual({
      basePath: '/users',
      guards: [ClassGuard],
      interceptors: [ClassInterceptor],
    });

    expect(getRouteMetadata(ExampleController.prototype, 'getUser')).toEqual({
      guards: [MethodGuard],
      interceptors: [MethodInterceptor],
      method: 'GET',
      path: '/:id',
      request: GetUserRequest,
      successStatus: 200,
    });

    expect(getDtoBindingSchema(GetUserRequest)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'id',
          optional: undefined,
          source: 'path',
        },
      },
      {
        propertyKey: 'note',
        metadata: {
          converter: NoopTestConverter,
          key: 'note',
          optional: true,
          source: 'body',
        },
      },
    ]);

    expect(getDtoValidationSchema(GetUserRequest)).toEqual([
      {
        propertyKey: 'note',
        rules: [
          { code: 'REQUIRED', kind: 'minLength', message: 'note is required', value: 1 },
          { kind: 'string' },
        ],
      },
    ]);

    expect(getClassValidationRules(ExampleController)).toHaveLength(1);
  });

  it('writes controller, route, and dto metadata when invoked by legacy decorator transforms', () => {
    class ClassGuard {
      canActivate() {}
    }

    class MethodGuard {
      canActivate() {}
    }

    class ClassInterceptor {
      intercept(_context: unknown, next: { handle(): Promise<unknown> }) {
        return next.handle();
      }
    }

    class MethodInterceptor {
      intercept(_context: unknown, next: { handle(): Promise<unknown> }) {
        return next.handle();
      }
    }

    class LegacyRequest {
      id = '';
      note?: string;
    }

    (Optional() as unknown as LegacyFieldDecoratorFn)(LegacyRequest.prototype, 'note');
    (Convert(NoopTestConverter) as unknown as LegacyFieldDecoratorFn)(LegacyRequest.prototype, 'note');
    (FromBody('note') as unknown as LegacyFieldDecoratorFn)(LegacyRequest.prototype, 'note');
    (FromPath('id') as unknown as LegacyFieldDecoratorFn)(LegacyRequest.prototype, 'id');

    class LegacyController {
      getUser() {
        return { ok: true };
      }
    }

    const getUserDescriptor = Object.getOwnPropertyDescriptor(LegacyController.prototype, 'getUser') ?? {};

    (UseInterceptors(MethodInterceptor) as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (UseGuards(MethodGuard) as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (Redirect('/users/1', 302) as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (Header('x-test', 'legacy') as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (Get('/:id') as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (Produces('application/json') as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (Version('1') as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (HttpCode(202) as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);
    (RequestDto(LegacyRequest) as unknown as LegacyMethodDecoratorFn)(LegacyController.prototype, 'getUser', getUserDescriptor);

    (UseInterceptors(ClassInterceptor) as unknown as LegacyClassDecoratorFn)(LegacyController);
    (UseGuards(ClassGuard) as unknown as LegacyClassDecoratorFn)(LegacyController);
    (Version('2') as unknown as LegacyClassDecoratorFn)(LegacyController);
    (Controller('/legacy') as unknown as LegacyClassDecoratorFn)(LegacyController);

    expect(getControllerMetadata(LegacyController)).toEqual({
      basePath: '/legacy',
      guards: [ClassGuard],
      interceptors: [ClassInterceptor],
      version: '2',
    });

    expect(getRouteMetadata(LegacyController.prototype, 'getUser')).toEqual({
      guards: [MethodGuard],
      headers: [{ name: 'x-test', value: 'legacy' }],
      interceptors: [MethodInterceptor],
      method: 'GET',
      path: '/:id',
      redirect: { url: '/users/1', statusCode: 302 },
      request: LegacyRequest,
      successStatus: 202,
      version: '1',
    });
    expect(getRouteProducesMetadata(LegacyController, 'getUser')).toEqual(['application/json']);

    expect(getDtoBindingSchema(LegacyRequest)).toEqual([
      {
        propertyKey: 'note',
        metadata: {
          converter: NoopTestConverter,
          key: 'note',
          optional: true,
          source: 'body',
        },
      },
      {
        propertyKey: 'id',
        metadata: {
          key: 'id',
          optional: undefined,
          source: 'path',
        },
      },
    ]);
  });

  it('stores handler-level produced media types', () => {
    @Controller('/feeds')
    class FeedController {
      @Produces('application/json', 'text/plain', 'application/json')
      @Get('/')
      getFeed() {
        return { ok: true };
      }
    }

    expect(getRouteProducesMetadata(FeedController, 'getFeed')).toEqual(['application/json', 'text/plain']);
  });

  it('rejects unsupported controller and route path syntax at decoration time', () => {
    expect(() => {
      @Controller('/files/*')
      class InvalidController {
      }

      return InvalidController;
    }).toThrow(InvalidRoutePathError);

    expect(() => {
      class InvalidRouteController {
        @Get('/files/:id.json')
        getFile() {
          return { ok: true };
        }
      }

      return InvalidRouteController;
    }).toThrow(InvalidRoutePathError);

    expect(() => {
      class InvalidMixedSegmentController {
        @Get('/users/user-:id')
        getUser() {
          return { ok: true };
        }
      }

      return InvalidMixedSegmentController;
    }).toThrow(InvalidRoutePathError);
  });

  it('preserves binding and validator metadata for PickType, OmitType, and IntersectionType', () => {
    class AddressRequest {
      @FromBody('city')
      @IsString()
      city = '';
    }

    class CreateUserRequest {
      @FromPath('id')
      id = '';

      @FromBody('name')
      @Convert(NoopTestConverter)
      @IsString()
      @MinLength(2, { code: 'NAME_MIN', message: 'name must be at least 2 chars' })
      name = '';

      @FromBody('nickname')
      @Optional()
      @IsString()
      nickname?: string;
    }

    const PickedRequest = PickType(CreateUserRequest, ['name']);
    const OmittedRequest = OmitType(CreateUserRequest, ['nickname']);
    const IntersectionRequest = IntersectionType(CreateUserRequest, AddressRequest);

    expect(getDtoBindingSchema(PickedRequest)).toEqual([
      {
        propertyKey: 'name',
        metadata: {
          converter: NoopTestConverter,
          key: 'name',
          optional: undefined,
          source: 'body',
        },
      },
    ]);
    expect(getDtoValidationSchema(PickedRequest)).toEqual([
      {
        propertyKey: 'name',
        rules: [
          { code: 'NAME_MIN', kind: 'minLength', message: 'name must be at least 2 chars', value: 2 },
          { kind: 'string' },
        ],
      },
    ]);

    expect(getDtoBindingSchema(OmittedRequest)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'id',
          optional: undefined,
          source: 'path',
        },
      },
      {
        propertyKey: 'name',
        metadata: {
          converter: NoopTestConverter,
          key: 'name',
          optional: undefined,
          source: 'body',
        },
      },
    ]);
    expect(getDtoValidationSchema(OmittedRequest)).toEqual([
      {
        propertyKey: 'name',
        rules: [
          { code: 'NAME_MIN', kind: 'minLength', message: 'name must be at least 2 chars', value: 2 },
          { kind: 'string' },
        ],
      },
    ]);

    expect(getDtoBindingSchema(IntersectionRequest)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'id',
          optional: undefined,
          source: 'path',
        },
      },
      {
        propertyKey: 'name',
        metadata: {
          converter: NoopTestConverter,
          key: 'name',
          optional: undefined,
          source: 'body',
        },
      },
      {
        propertyKey: 'nickname',
        metadata: {
          key: 'nickname',
          optional: true,
          source: 'body',
        },
      },
      {
        propertyKey: 'city',
        metadata: {
          key: 'city',
          optional: undefined,
          source: 'body',
        },
      },
    ]);
    expect(getDtoValidationSchema(IntersectionRequest)).toEqual([
      {
        propertyKey: 'name',
        rules: [
          { code: 'NAME_MIN', kind: 'minLength', message: 'name must be at least 2 chars', value: 2 },
          { kind: 'string' },
        ],
      },
      {
        propertyKey: 'nickname',
        rules: [{ kind: 'string' }],
      },
      {
        propertyKey: 'city',
        rules: [{ kind: 'string' }],
      },
    ]);
  });

  it('makes inherited binding and validation metadata optional for PartialType', () => {
    class UpdateUserRequest {
      @FromBody('name')
      @Convert(NoopTestConverter)
      @IsString()
      @MinLength(2, { code: 'NAME_MIN', message: 'name must be at least 2 chars' })
      name = '';

      @FromPath('id')
      id = '';
    }

    const PartialUpdateUserRequest = PartialType(UpdateUserRequest);

    expect(getDtoBindingSchema(PartialUpdateUserRequest)).toEqual([
      {
        propertyKey: 'name',
        metadata: {
          converter: NoopTestConverter,
          key: 'name',
          optional: true,
          source: 'body',
        },
      },
      {
        propertyKey: 'id',
        metadata: {
          key: 'id',
          optional: true,
          source: 'path',
        },
      },
    ]);
    expect(getDtoValidationSchema(PartialUpdateUserRequest)).toEqual([
      {
        propertyKey: 'name',
        rules: [
          { code: 'NAME_MIN', kind: 'minLength', message: 'name must be at least 2 chars', value: 2 },
          { kind: 'string' },
          { kind: 'optional' },
        ],
      },
    ]);
  });

  it('does not execute base DTO constructors while creating mapped DTO helpers', () => {
    const constructorCalls: string[] = [];

    class BaseRequest {
      @FromBody('name')
      @IsString()
      name = '';

      constructor() {
        constructorCalls.push('base');
      }
    }

    class SecondaryRequest {
      @FromBody('city')
      @IsString()
      city = '';

      constructor() {
        constructorCalls.push('secondary');
      }
    }

    const Picked = PickType(BaseRequest, ['name']);
    const Omitted = OmitType(BaseRequest, []);
    const Partial = PartialType(BaseRequest);
    const Intersected = IntersectionType(BaseRequest, SecondaryRequest);

    expect(constructorCalls).toEqual([]);

    expect(new Picked()).toEqual({ name: undefined });
    expect(new Omitted()).toEqual({ name: undefined });
    expect(new Partial()).toEqual({ name: undefined });
    expect(new Intersected()).toEqual({ city: undefined, name: undefined });
  });

  it('adds at most one optional validation rule per field in PartialType', () => {
    class UpdateUserRequest {
      @FromBody('name')
      @IsString()
      @Optional()
      @MinLength(2)
      name = '';
    }

    const PartialUpdateUserRequest = PartialType(UpdateUserRequest);
    const schema = getDtoValidationSchema(PartialUpdateUserRequest);
    let nameRules: Array<{ kind: string }> = [];

    for (const entry of schema) {
      if (entry.propertyKey === 'name') {
        nameRules = entry.rules as Array<{ kind: string }>;
        break;
      }
    }

    const optionalRules: Array<{ kind: string }> = [];
    for (const rule of nameRules) {
      if (rule.kind === 'optional') {
        optionalRules.push(rule);
      }
    }

    expect(optionalRules).toHaveLength(1);
  });

  it('stores converter metadata regardless of decorator lexical order', () => {
    class OrderedRequest {
      @Convert(NoopTestConverter)
      @FromQuery('id')
      id = 0;
    }

    expect(getDtoBindingSchema(OrderedRequest)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          converter: NoopTestConverter,
          key: 'id',
          optional: undefined,
          source: 'query',
        },
      },
    ]);
  });

  it('installs Symbol.metadata when the HTTP decorator module is imported', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');

    vi.resetModules();
    delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;

    try {
      const decoratorModuleSpecifier = './decorators.js?http-ensure-metadata';
      await import(/* @vite-ignore */ decoratorModuleSpecifier);

      expect(typeof (Symbol as typeof Symbol & { metadata?: symbol }).metadata).toBe('symbol');
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
      }
      vi.resetModules();
    }
  });
});
