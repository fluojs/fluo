import { describe, expect, it } from 'vitest';

import { getControllerMetadata, getDtoBindingSchema, getRouteMetadata } from '@konekti/core';

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
} from './decorators';

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
      @Optional()
      note?: string;
    }

    @Controller('/users')
    @UseGuard(ClassGuard)
    @UseInterceptor(ClassInterceptor)
    class ExampleController {
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
  });
});
