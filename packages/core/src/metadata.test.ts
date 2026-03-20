import { describe, expect, it } from 'vitest';

import {
  defineClassDiMetadata,
  defineControllerMetadata,
  defineDtoFieldBindingMetadata,
  defineModuleMetadata,
  defineRouteMetadata,
  getClassDiMetadata,
  getControllerMetadata,
  getDtoBindingSchema,
  getDtoFieldBindingMetadata,
  getInheritedClassDiMetadata,
  getModuleMetadata,
  getOwnClassDiMetadata,
  getRouteMetadata,
} from './metadata.js';

describe('metadata helpers', () => {
  it('round-trips module metadata', () => {
    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      exports: ['LOGGER'],
      global: true,
      imports: ['SharedModule'],
      middleware: ['LoggingMiddleware'],
      providers: ['LoggerProvider'],
    });

    expect(getModuleMetadata(ExampleModule)).toEqual({
      exports: ['LOGGER'],
      global: true,
      imports: ['SharedModule'],
      middleware: ['LoggingMiddleware'],
      providers: ['LoggerProvider'],
      controllers: undefined,
    });
  });

  it('preserves prior module collections across partial writes and returns clones', () => {
    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      imports: ['SharedModule'],
      providers: ['LoggerProvider'],
    });
    defineModuleMetadata(ExampleModule, {
      global: true,
      middleware: ['LoggingMiddleware'],
    });

    const metadata = getModuleMetadata(ExampleModule);

    expect(metadata).toEqual({
      controllers: undefined,
      exports: undefined,
      global: true,
      imports: ['SharedModule'],
      middleware: ['LoggingMiddleware'],
      providers: ['LoggerProvider'],
    });

    const mutatedImports = [...(metadata?.imports ?? [])];
    mutatedImports.push('MutatedModule');

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: undefined,
      exports: undefined,
      global: true,
      imports: ['SharedModule'],
      middleware: ['LoggingMiddleware'],
      providers: ['LoggerProvider'],
    });
  });

  it('round-trips controller and route metadata', () => {
    class ExampleController {
      getUser() {
        return { ok: true };
      }
    }

    defineControllerMetadata(ExampleController, {
      basePath: '/users',
      guards: ['AuthGuard'],
      version: '1',
    });

    defineRouteMetadata(ExampleController.prototype, 'getUser', {
      method: 'GET',
      path: '/:id',
      successStatus: 200,
      version: '2',
    });

    expect(getControllerMetadata(ExampleController)).toEqual({
      basePath: '/users',
      guards: ['AuthGuard'],
      interceptors: undefined,
      version: '1',
    });

    expect(getRouteMetadata(ExampleController.prototype, 'getUser')).toEqual({
      method: 'GET',
      path: '/:id',
      successStatus: 200,
      version: '2',
    });
  });

  it('builds DTO binding schema from field metadata', () => {
    class GetUserRequest {
      id!: string;
    }

    defineDtoFieldBindingMetadata(GetUserRequest.prototype, 'id', {
      key: 'id',
      source: 'path',
    });

    expect(getDtoBindingSchema(GetUserRequest)).toEqual([
      {
        propertyKey: 'id',
        metadata: {
          key: 'id',
          source: 'path',
        },
      },
    ]);
    expect(getDtoFieldBindingMetadata(GetUserRequest.prototype, 'id')).toEqual({
      key: 'id',
      source: 'path',
    });
  });

  it('round-trips class DI metadata', () => {
    class ExampleService {}

    defineClassDiMetadata(ExampleService, {
      inject: ['LOGGER'],
      scope: 'request',
    });

    expect(getClassDiMetadata(ExampleService)).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
  });

  it('merges inject and scope metadata written in separate passes', () => {
    class ExampleService {}

    defineClassDiMetadata(ExampleService, {
      inject: ['LOGGER'],
    });
    defineClassDiMetadata(ExampleService, {
      scope: 'request',
    });

    expect(getOwnClassDiMetadata(ExampleService)).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
  });

  it('falls back to inherited DI metadata while keeping own lookups explicit', () => {
    class BaseService {}

    defineClassDiMetadata(BaseService, {
      inject: ['LOGGER'],
      scope: 'request',
    });

    class ChildService extends BaseService {}

    expect(getOwnClassDiMetadata(ChildService)).toBeUndefined();
    expect(getInheritedClassDiMetadata(ChildService)).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
    expect(getClassDiMetadata(ChildService)).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
  });

  it('merges child DI metadata with inherited fallback and clones returned arrays', () => {
    class BaseService {}

    defineClassDiMetadata(BaseService, {
      inject: ['LOGGER'],
      scope: 'request',
    });

    class ChildService extends BaseService {}

    defineClassDiMetadata(ChildService, {
      inject: ['CACHE'],
    });

    const metadata = getInheritedClassDiMetadata(ChildService);

    expect(getOwnClassDiMetadata(ChildService)).toEqual({
      inject: ['CACHE'],
      scope: undefined,
    });
    expect(metadata).toEqual({
      inject: ['CACHE'],
      scope: 'request',
    });

    const mutatedInject = [...(metadata?.inject ?? [])];
    mutatedInject.push('MUTATED');

    expect(getInheritedClassDiMetadata(ChildService)).toEqual({
      inject: ['CACHE'],
      scope: 'request',
    });
  });
});
