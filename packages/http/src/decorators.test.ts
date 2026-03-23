import { describe, expect, it } from 'vitest';

import { getClassValidationRules, getControllerMetadata, getDtoBindingSchema, getDtoValidationSchema, getRouteMetadata } from '@konekti/core';

import {
  Controller,
  FromBody,
  FromPath,
  Get,
  Optional,
  Produces,
  RequestDto,
  SuccessStatus,
  UseGuard,
  UseInterceptor,
  getRouteProducesMetadata,
} from './decorators.js';
import { IntersectionType, OmitType, PartialType, PickType } from './mapped-types.js';
import { IsString, MinLength, ValidateClass } from '@konekti/dto-validator';

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
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'note is required' })
      @Optional()
      note?: string;
    }

    @ValidateClass((value) => {
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
    @UseGuard(ClassGuard)
    @UseInterceptor(ClassInterceptor)
    class ExampleController {
      requestCount = 1;

      @RequestDto(GetUserRequest)
      @SuccessStatus(200)
      @Get('/:id')
      @UseGuard(MethodGuard)
      @UseInterceptor(MethodInterceptor)
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
});
