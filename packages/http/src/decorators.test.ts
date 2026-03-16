import { describe, expect, it } from 'vitest';

import { getClassValidationRules, getControllerMetadata, getDtoBindingSchema, getDtoValidationSchema, getRouteMetadata } from '@konekti/core';

import {
  Controller,
  FromBody,
  FromPath,
  Get,
  Optional,
  RequestDto,
  SuccessStatus,
  UseGuard,
  UseInterceptor,
} from './decorators.js';
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
});
