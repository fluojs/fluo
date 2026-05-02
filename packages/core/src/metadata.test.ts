import { describe, expect, it } from 'vitest';

import {
  appendDtoFieldValidationRule,
  defineClassDiMetadata,
  defineControllerMetadata,
  defineDtoFieldBindingMetadata,
  defineInjectionMetadata,
  defineModuleMetadata,
  defineRouteMetadata,
  ensureMetadataSymbol,
  getClassDiMetadata,
  getControllerMetadata,
  getDtoBindingSchema,
  getDtoValidationSchema,
  getDtoFieldBindingMetadata,
  getInheritedClassDiMetadata,
  getInjectionSchema,
  getModuleMetadata,
  getOwnClassDiMetadata,
  getRouteMetadata,
} from './metadata.js';
import {
  getOwnStandardConstructorMetadataBag,
  getStandardConstructorMetadataBag,
  getStandardConstructorMetadataMap,
  getStandardConstructorMetadataRecord,
  getStandardMetadataBag,
  metadataSymbol,
  standardMetadataKeys,
  type StandardMetadataBag,
} from './metadata/shared.js';

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

  it('preserves prior module collections across partial writes and returns a frozen stable snapshot', () => {
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

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.imports)).toBe(true);
    expect(getModuleMetadata(ExampleModule)).toBe(metadata);
    expect(() => (metadata?.imports as unknown as unknown[]).push('MutatedModule')).toThrow(TypeError);

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: undefined,
      exports: undefined,
      global: true,
      imports: ['SharedModule'],
      middleware: ['LoggingMiddleware'],
      providers: ['LoggerProvider'],
    });
  });

  it('preserves explicit global false across partial module metadata writes', () => {
    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      global: true,
      providers: ['LoggerProvider'],
    });
    defineModuleMetadata(ExampleModule, {
      global: false,
    });

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: undefined,
      exports: undefined,
      global: false,
      imports: undefined,
      middleware: undefined,
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

  it('merges explicit controller and route metadata before standard metadata while preserving order', () => {
    const explicitGuard = Symbol('explicitGuard');
    const standardGuard = Symbol('standardGuard');
    const explicitInterceptor = Symbol('explicitInterceptor');
    const standardInterceptor = Symbol('standardInterceptor');

    class ExampleController {
      getUser() {
        return { ok: true };
      }
    }

    Object.defineProperty(ExampleController, ensureMetadataSymbol(), {
      configurable: true,
      value: {
        [standardMetadataKeys.controller]: {
          basePath: '/standard',
          guards: [standardGuard],
          interceptors: [standardInterceptor],
          version: 'standard-v1',
        },
        [standardMetadataKeys.route]: new Map([
          ['getUser', {
            guards: [standardGuard],
            interceptors: [standardInterceptor],
            method: 'GET',
            path: '/standard/:id',
            successStatus: 200,
            version: 'standard-v2',
          }],
        ]),
      },
    });

    defineControllerMetadata(ExampleController, {
      basePath: '/explicit',
      guards: [explicitGuard, standardGuard],
      interceptors: [explicitInterceptor, standardInterceptor],
      version: 'explicit-v1',
    });
    defineRouteMetadata(ExampleController.prototype, 'getUser', {
      guards: [explicitGuard, standardGuard],
      interceptors: [explicitInterceptor, standardInterceptor],
      method: 'POST',
      path: '/explicit/:id',
      successStatus: 201,
      version: 'explicit-v2',
    });

    expect(getControllerMetadata(ExampleController)).toEqual({
      basePath: '/explicit',
      guards: [explicitGuard, standardGuard],
      interceptors: [explicitInterceptor, standardInterceptor],
      version: 'explicit-v1',
    });
    expect(getRouteMetadata(ExampleController.prototype, 'getUser')).toEqual({
      guards: [explicitGuard, standardGuard],
      interceptors: [explicitInterceptor, standardInterceptor],
      method: 'POST',
      path: '/explicit/:id',
      successStatus: 201,
      version: 'explicit-v2',
    });
  });

  it('returns cloned nested route metadata objects', () => {
    class ExampleController {
      getUser() {
        return { ok: true };
      }
    }

    defineRouteMetadata(ExampleController.prototype, 'getUser', {
      headers: [{ name: 'x-test', value: 'v1' }],
      method: 'GET',
      path: '/users',
      redirect: {
        statusCode: 302,
        url: '/moved',
      },
    });

    const metadata = getRouteMetadata(ExampleController.prototype, 'getUser');

    if (metadata?.headers?.[0]) {
      metadata.headers[0].value = 'mutated';
    }

    if (metadata?.redirect) {
      metadata.redirect.url = '/mutated';
    }

    expect(getRouteMetadata(ExampleController.prototype, 'getUser')).toEqual({
      headers: [{ name: 'x-test', value: 'v1' }],
      method: 'GET',
      path: '/users',
      redirect: {
        statusCode: 302,
        url: '/moved',
      },
    });
  });

  it('preserves custom middleware instances while freezing and reusing the module middleware array', () => {
    class ExampleMiddleware {
      calls = 0;

      handle() {
        this.calls += 1;
      }
    }

    const middleware = new ExampleMiddleware();

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      middleware: [middleware],
    });

    const metadata = getModuleMetadata(ExampleModule);
    const returnedMiddleware = metadata?.middleware?.[0] as typeof middleware | undefined;

    expect(returnedMiddleware).toBe(middleware);
    expect(Object.isFrozen(returnedMiddleware)).toBe(false);
    expect(metadata?.middleware).not.toBeUndefined();
    expect(metadata?.middleware).toBe((getModuleMetadata(ExampleModule)?.middleware as unknown[] | undefined));
    returnedMiddleware?.handle();
    expect(middleware.calls).toBe(1);
  });

  it('freezes middleware route-config wrappers while preserving runtime middleware references', () => {
    class ExampleMiddleware {
      calls = 0;

      handle() {
        this.calls += 1;
      }
    }

    const middleware = new ExampleMiddleware();
    const routes = ['/users'];
    const routeConfig = { middleware, routes };

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      middleware: [routeConfig],
    });

    routes.push('/mutated');
    routeConfig.routes = ['/replaced'];

    const metadata = getModuleMetadata(ExampleModule);
    const returnedConfig = metadata?.middleware?.[0] as { middleware: ExampleMiddleware; routes: string[] } | undefined;

    expect(Object.isFrozen(returnedConfig)).toBe(true);
    expect(Object.isFrozen(returnedConfig?.routes)).toBe(true);
    expect(returnedConfig?.routes).toEqual(['/users']);
    expect(returnedConfig?.routes).not.toBe(routes);
    expect(returnedConfig?.middleware).toBe(middleware);
    expect(Object.isFrozen(returnedConfig?.middleware)).toBe(false);

    returnedConfig?.middleware.handle();
    expect(middleware.calls).toBe(1);
  });

  it('preserves useValue payload identity and mutability in frozen module snapshots', () => {
    const value = { count: 0 };

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      providers: [{ provide: 'COUNTER', useValue: value }],
    });

    const metadata = getModuleMetadata(ExampleModule);
    const provider = metadata?.providers?.[0] as { useValue: typeof value } | undefined;

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.providers)).toBe(true);
    expect(provider?.useValue).toBe(value);
    expect(Object.isFrozen(provider?.useValue)).toBe(false);

    value.count += 1;
    expect(provider?.useValue.count).toBe(1);
  });

  it('freezes provider descriptor wrappers without freezing useValue payloads', () => {
    const value = { count: 0 };

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      providers: [{ provide: 'COUNTER', useValue: value }],
    });

    const metadata = getModuleMetadata(ExampleModule);
    const provider = metadata?.providers?.[0] as { provide: string; useValue: typeof value } | undefined;

    expect(Object.isFrozen(metadata?.providers)).toBe(true);
    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider?.useValue)).toBe(false);
    expect(() => {
      if (provider) {
        provider.provide = 'MUTATED';
      }
    }).toThrow(TypeError);

    value.count += 1;
    defineModuleMetadata(ExampleModule, {
      global: true,
    });

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: undefined,
      exports: undefined,
      global: true,
      imports: undefined,
      middleware: undefined,
      providers: [{ provide: 'COUNTER', useValue: value }],
    });
    expect((getModuleMetadata(ExampleModule)?.providers?.[0] as { useValue: typeof value } | undefined)?.useValue.count).toBe(1);
  });

  it('freezes and detaches factory provider inject arrays in stable module snapshots', () => {
    const inject = ['CONFIG'];

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      providers: [{ provide: 'SERVICE', useFactory: () => 'service', inject }],
    });

    const metadata = getModuleMetadata(ExampleModule);
    const provider = metadata?.providers?.[0] as { inject: string[] } | undefined;

    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider?.inject)).toBe(true);
    expect(provider?.inject).not.toBe(inject);
    expect(() => provider?.inject.push('MUTATED')).toThrow(TypeError);

    inject.push('ORIGINAL_MUTATED');
    defineModuleMetadata(ExampleModule, {
      global: true,
    });

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: undefined,
      exports: undefined,
      global: true,
      imports: undefined,
      middleware: undefined,
      providers: [{ provide: 'SERVICE', useFactory: expect.any(Function), inject: ['CONFIG'] }],
    });
  });

  it('freezes module controllers and exports snapshots across caller mutations', () => {
    class ExampleController {}
    class ExportedProvider {}

    const controllers = [ExampleController];
    const exports = [ExportedProvider];

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      controllers,
      exports,
    });

    const metadata = getModuleMetadata(ExampleModule);

    expect(Object.isFrozen(metadata?.controllers)).toBe(true);
    expect(Object.isFrozen(metadata?.exports)).toBe(true);
    expect(metadata?.controllers).toEqual([ExampleController]);
    expect(metadata?.exports).toEqual([ExportedProvider]);
    expect(() => metadata?.controllers?.push(class MutatedController {})).toThrow(TypeError);
    expect(() => metadata?.exports?.push(class MutatedExport {})).toThrow(TypeError);

    controllers.push(class CallerMutatedController {});
    exports.push(class CallerMutatedExport {});
    defineModuleMetadata(ExampleModule, {
      global: true,
    });

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: [ExampleController],
      exports: [ExportedProvider],
      global: true,
      imports: undefined,
      middleware: undefined,
      providers: undefined,
    });
  });

  it('does not freeze runtime guard or interceptor instances read from controller and route metadata', () => {
    class RuntimeGuard {
      calls = 0;

      canActivate() {
        return true;
      }
    }

    class RuntimeInterceptor {
      calls = 0;

      intercept() {
        return undefined;
      }
    }

    const guard = new RuntimeGuard();
    const interceptor = new RuntimeInterceptor();

    class ExampleController {
      getUser() {
        return { ok: true };
      }
    }

    defineControllerMetadata(ExampleController, {
      basePath: '/users',
      guards: [guard],
      interceptors: [interceptor],
    });
    defineRouteMetadata(ExampleController.prototype, 'getUser', {
      guards: [guard],
      interceptors: [interceptor],
      method: 'GET',
      path: '/:id',
    });

    const controllerMetadata = getControllerMetadata(ExampleController);
    const routeMetadata = getRouteMetadata(ExampleController.prototype, 'getUser');

    expect(controllerMetadata?.guards?.[0]).toBe(guard);
    expect(controllerMetadata?.interceptors?.[0]).toBe(interceptor);
    expect(routeMetadata?.guards?.[0]).toBe(guard);
    expect(routeMetadata?.interceptors?.[0]).toBe(interceptor);
    expect(Object.isFrozen(guard)).toBe(false);
    expect(Object.isFrozen(interceptor)).toBe(false);

    guard.calls += 1;
    interceptor.calls += 1;
    expect(guard.calls).toBe(1);
    expect(interceptor.calls).toBe(1);
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

  it('round-trips injection schema metadata and returns fresh schema entries', () => {
    class ExampleController {
      service!: string;
    }

    defineInjectionMetadata(ExampleController.prototype, 'service', {
      optional: true,
      token: 'LOGGER',
    });

    const schema = getInjectionSchema(ExampleController.prototype);

    expect(schema).toEqual([
      {
        propertyKey: 'service',
        metadata: {
          optional: true,
          token: 'LOGGER',
        },
      },
    ]);

    schema[0]?.metadata && ((schema[0].metadata as unknown as { token: string }).token = 'MUTATED');

    expect(getInjectionSchema(ExampleController.prototype)).toEqual([
      {
        propertyKey: 'service',
        metadata: {
          optional: true,
          token: 'LOGGER',
        },
      },
    ]);
  });

  it('merges explicit injection metadata before standard metadata while preserving schema order', () => {
    class ExampleController {
      service!: string;
      audit!: string;
      metrics!: string;
    }

    Object.defineProperty(ExampleController, ensureMetadataSymbol(), {
      configurable: true,
      value: {
        [standardMetadataKeys.injection]: new Map([
          ['service', { optional: false, token: 'STANDARD_SERVICE' }],
          ['metrics', { optional: true, token: 'METRICS' }],
        ]),
      },
    });

    defineInjectionMetadata(ExampleController.prototype, 'service', {
      optional: true,
      token: 'EXPLICIT_SERVICE',
    });
    defineInjectionMetadata(ExampleController.prototype, 'audit', {
      optional: false,
      token: 'AUDIT',
    });

    expect(getInjectionSchema(ExampleController.prototype)).toEqual([
      {
        propertyKey: 'service',
        metadata: {
          optional: true,
          token: 'EXPLICIT_SERVICE',
        },
      },
      {
        propertyKey: 'audit',
        metadata: {
          optional: false,
          token: 'AUDIT',
        },
      },
      {
        propertyKey: 'metrics',
        metadata: {
          optional: true,
          token: 'METRICS',
        },
      },
    ]);
  });

  it('preserves DTO validation append order while rebuilding fresh rule arrays', () => {
    class ExampleDto {
      name!: string;
    }

    appendDtoFieldValidationRule(ExampleDto.prototype, 'name', { kind: 'string' });
    appendDtoFieldValidationRule(ExampleDto.prototype, 'name', { kind: 'minLength', value: 2 });

    const schema = getDtoValidationSchema(ExampleDto);

    expect(schema).toEqual([
      {
        propertyKey: 'name',
        rules: [{ kind: 'string' }, { kind: 'minLength', value: 2 }],
      },
    ]);

    (schema[0]?.rules as unknown as Array<{ kind: string }>).push({ kind: 'mutated' });

    expect(getDtoValidationSchema(ExampleDto)).toEqual([
      {
        propertyKey: 'name',
        rules: [{ kind: 'string' }, { kind: 'minLength', value: 2 }],
      },
    ]);
  });

  it('returns cloned DTO validation rule payloads for nested rule objects', () => {
    class ExampleDto {
      tags!: string[];
    }

    appendDtoFieldValidationRule(ExampleDto.prototype, 'tags', {
      kind: 'in',
      values: ['a', 'b'],
    });

    const schema = getDtoValidationSchema(ExampleDto);
    const firstRule = schema[0]?.rules[0];

    if (firstRule && firstRule.kind === 'in') {
      (firstRule.values as string[]).push('mutated');
    }

    expect(getDtoValidationSchema(ExampleDto)).toEqual([
      {
        propertyKey: 'tags',
        rules: [{ kind: 'in', values: ['a', 'b'] }],
      },
    ]);
  });

  it('round-trips DTO binding metadata including converter references', () => {
    class TrimConverter {
      convert(value: unknown) {
        return value;
      }
    }

    class ExampleDto {}

    defineDtoFieldBindingMetadata(ExampleDto.prototype, 'name', {
      converter: TrimConverter,
      key: 'name',
      optional: true,
      source: 'body',
    });

    expect(getDtoFieldBindingMetadata(ExampleDto.prototype, 'name')).toEqual({
      converter: TrimConverter,
      key: 'name',
      optional: true,
      source: 'body',
    });
    expect(getDtoBindingSchema(ExampleDto)).toEqual([
      {
        propertyKey: 'name',
        metadata: {
          converter: TrimConverter,
          key: 'name',
          optional: true,
          source: 'body',
        },
      },
    ]);
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

  it('returns a frozen stable own class DI metadata snapshot', () => {
    class ExampleService {}

    defineClassDiMetadata(ExampleService, {
      inject: ['LOGGER'],
      scope: 'request',
    });

    const metadata = getOwnClassDiMetadata(ExampleService);

    expect(metadata).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.inject)).toBe(true);
    expect(getOwnClassDiMetadata(ExampleService)).toBe(metadata);
    expect(() => (metadata?.inject as unknown as unknown[]).push('MUTATED')).toThrow(TypeError);
  });

  it('does not retain caller-owned inject arrays across partial class DI writes', () => {
    class ExampleService {}

    const inject = ['LOGGER'];

    defineClassDiMetadata(ExampleService, {
      inject,
    });
    inject.push('MUTATED');
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

  it('merges child DI metadata with inherited fallback and freezes the cached effective snapshot', () => {
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
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.inject)).toBe(true);
    expect(getInheritedClassDiMetadata(ChildService)).toBe(metadata);

    expect(() => (metadata?.inject as unknown as unknown[]).push('MUTATED')).toThrow(TypeError);

    expect(getInheritedClassDiMetadata(ChildService)).toEqual({
      inject: ['CACHE'],
      scope: 'request',
    });
  });

  it('treats explicit empty inject arrays as an override instead of inheriting parent inject tokens', () => {
    const LOGGER = Symbol('LOGGER');

    class BaseService {}

    defineClassDiMetadata(BaseService, {
      inject: [LOGGER],
      scope: 'request',
    });

    class ChildService extends BaseService {}

    defineClassDiMetadata(ChildService, {
      inject: [],
    });

    expect(getOwnClassDiMetadata(ChildService)).toEqual({
      inject: [],
      scope: undefined,
    });
    expect(getInheritedClassDiMetadata(ChildService)).toEqual({
      inject: [],
      scope: 'request',
    });
  });

  it('invalidates cached inherited DI metadata after later metadata writes', () => {
    class BaseService {}

    defineClassDiMetadata(BaseService, {
      inject: ['LOGGER'],
    });

    class ChildService extends BaseService {}

    const cached = getInheritedClassDiMetadata(ChildService);

    expect(cached).toEqual({
      inject: ['LOGGER'],
      scope: undefined,
    });
    expect(getInheritedClassDiMetadata(ChildService)).toBe(cached);

    defineClassDiMetadata(BaseService, {
      scope: 'request',
    });

    const refreshed = getInheritedClassDiMetadata(ChildService);

    expect(refreshed).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
    expect(refreshed).not.toBe(cached);
  });

  it('ensures Symbol.metadata is available through the exported initializer', () => {
    expect(ensureMetadataSymbol()).toBe((Symbol as typeof Symbol & { metadata?: symbol }).metadata);
  });

  it('does not install the Symbol.metadata polyfill when the shared metadata module is imported', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');

    delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;

    try {
      const sharedSpecifier = './metadata/shared.js?without-polyfill';
      const sharedMetadata = await import(/* @vite-ignore */ sharedSpecifier);

      expect((Symbol as typeof Symbol & { metadata?: symbol }).metadata).toBeUndefined();
      expect(sharedMetadata.metadataSymbol).toBe(Symbol.for('fluo.symbol.metadata'));
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
      }
      ensureMetadataSymbol();
    }
  });

  it('tracks a native Symbol.metadata replacement after the fallback was installed', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const fallbackSymbol = ensureMetadataSymbol();
    const nativeSymbol = Symbol('native.metadata');

    class ExampleController {}

    Object.defineProperty(Symbol, 'metadata', {
      configurable: true,
      value: nativeSymbol,
    });
    Object.defineProperty(ExampleController, nativeSymbol, {
      configurable: true,
      value: {
        [standardMetadataKeys.controller]: { basePath: '/native' },
      },
    });

    try {
      expect(fallbackSymbol).not.toBe(nativeSymbol);
      expect(getStandardMetadataBag(ExampleController)).toEqual({
        [standardMetadataKeys.controller]: { basePath: '/native' },
      });
      expect(metadataSymbol).toBe(nativeSymbol);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
      }
      ensureMetadataSymbol();
    }
  });

  it('reads standard metadata written before and after Symbol.metadata replacement in one process', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const fallbackSymbol = ensureMetadataSymbol();
    const nativeSymbol = Symbol('native.metadata');
    const fallbackInjectionMetadata = new Map([['fallbackService', { optional: true, token: 'FALLBACK_LOGGER' }]]);
    const nativeInjectionMetadata = new Map([['nativeService', { optional: false, token: 'NATIVE_LOGGER' }]]);

    class FallbackEraController {
      fallbackService!: string;
    }

    Object.defineProperty(FallbackEraController, fallbackSymbol, {
      configurable: true,
      value: {
        [standardMetadataKeys.controller]: { basePath: '/fallback-era' },
        [standardMetadataKeys.injection]: fallbackInjectionMetadata,
      },
    });

    Object.defineProperty(Symbol, 'metadata', {
      configurable: true,
      value: nativeSymbol,
    });

    class NativeEraController {
      nativeService!: string;
    }

    Object.defineProperty(NativeEraController, nativeSymbol, {
      configurable: true,
      value: {
        [standardMetadataKeys.controller]: { basePath: '/native-era' },
        [standardMetadataKeys.injection]: nativeInjectionMetadata,
      },
    });

    try {
      expect(fallbackSymbol).not.toBe(nativeSymbol);
      expect(getStandardConstructorMetadataRecord<{ basePath: string }>(
        FallbackEraController.prototype,
        standardMetadataKeys.controller,
      )).toEqual({ basePath: '/fallback-era' });
      expect(getStandardConstructorMetadataMap(FallbackEraController.prototype, standardMetadataKeys.injection)).toBe(
        fallbackInjectionMetadata,
      );
      expect(getStandardConstructorMetadataRecord<{ basePath: string }>(
        NativeEraController.prototype,
        standardMetadataKeys.controller,
      )).toEqual({ basePath: '/native-era' });
      expect(getStandardConstructorMetadataMap(NativeEraController.prototype, standardMetadataKeys.injection)).toBe(
        nativeInjectionMetadata,
      );
      expect(metadataSymbol).toBe(nativeSymbol);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
      }
      ensureMetadataSymbol();
    }
  });

  it('overlays own fallback-era standard metadata over inherited active metadata', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const fallbackSymbol = ensureMetadataSymbol();
    const nativeSymbol = Symbol('native.metadata');
    const inheritedNativeInjectionMetadata = new Map([['service', { optional: true, token: 'NATIVE_LOGGER' }]]);
    const inheritedNativeBag: StandardMetadataBag = {
      [standardMetadataKeys.controller]: { basePath: '/base-native' },
      [standardMetadataKeys.injection]: inheritedNativeInjectionMetadata,
    };
    const ownFallbackBag: StandardMetadataBag = {
      [standardMetadataKeys.controller]: { basePath: '/child-fallback' },
    };

    class BaseController {}
    class ChildController extends BaseController {}

    Object.defineProperty(Symbol, 'metadata', {
      configurable: true,
      value: nativeSymbol,
    });
    Object.defineProperty(BaseController, nativeSymbol, {
      configurable: true,
      value: inheritedNativeBag,
    });
    Object.defineProperty(ChildController, fallbackSymbol, {
      configurable: true,
      value: ownFallbackBag,
    });

    try {
      const metadataBag = getStandardMetadataBag(ChildController);

      expect(metadataBag?.[standardMetadataKeys.controller]).toEqual({ basePath: '/child-fallback' });
      expect(metadataBag?.[standardMetadataKeys.injection]).toBe(inheritedNativeInjectionMetadata);
      expect(getStandardConstructorMetadataRecord<{ basePath: string }>(
        ChildController.prototype,
        standardMetadataKeys.controller,
      )).toEqual({ basePath: '/child-fallback' });
      expect(getStandardConstructorMetadataMap(ChildController.prototype, standardMetadataKeys.injection)).toBe(
        inheritedNativeInjectionMetadata,
      );
      expect(getOwnStandardConstructorMetadataBag(ChildController)).toBe(ownFallbackBag);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
      }
      ensureMetadataSymbol();
    }
  });

  it('reads inherited fallback-era metadata when the child owns native metadata', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const fallbackSymbol = ensureMetadataSymbol();
    const nativeSymbol = Symbol('native.metadata');
    const inheritedFallbackInjectionMetadata = new Map([['service', { optional: true, token: 'FALLBACK_LOGGER' }]]);
    const inheritedFallbackBag: StandardMetadataBag = {
      [standardMetadataKeys.injection]: inheritedFallbackInjectionMetadata,
    };
    const ownNativeBag: StandardMetadataBag = {
      [standardMetadataKeys.controller]: { basePath: '/child-native' },
    };

    class BaseController {}
    class ChildController extends BaseController {}

    Object.defineProperty(BaseController, fallbackSymbol, {
      configurable: true,
      value: inheritedFallbackBag,
    });
    Object.defineProperty(Symbol, 'metadata', {
      configurable: true,
      value: nativeSymbol,
    });
    Object.defineProperty(ChildController, nativeSymbol, {
      configurable: true,
      value: ownNativeBag,
    });

    try {
      const metadataBag = getStandardMetadataBag(ChildController);

      expect(metadataBag?.[standardMetadataKeys.controller]).toEqual({ basePath: '/child-native' });
      expect(metadataBag?.[standardMetadataKeys.injection]).toBe(inheritedFallbackInjectionMetadata);
      expect(getStandardConstructorMetadataRecord<{ basePath: string }>(
        ChildController.prototype,
        standardMetadataKeys.controller,
      )).toEqual({ basePath: '/child-native' });
      expect(getStandardConstructorMetadataMap(ChildController.prototype, standardMetadataKeys.injection)).toBe(
        inheritedFallbackInjectionMetadata,
      );
      expect(getOwnStandardConstructorMetadataBag(ChildController)).toBe(ownNativeBag);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Symbol, 'metadata', originalDescriptor);
      } else {
        delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
      }
      ensureMetadataSymbol();
    }
  });

  it('reads standard metadata bags and constructor-level records through Symbol.metadata', () => {
    const metadataSymbol = ensureMetadataSymbol();
    const injectionMetadata = new Map([['service', { optional: true, token: 'LOGGER' }]]);
    const metadataBag: StandardMetadataBag = {
      [standardMetadataKeys.controller]: { basePath: '/users' },
      [standardMetadataKeys.injection]: injectionMetadata,
    };

    class ExampleController {
      service!: string;
    }

    Object.defineProperty(ExampleController, metadataSymbol, {
      configurable: true,
      value: metadataBag,
    });

    expect(getStandardMetadataBag(ExampleController)).toBe(metadataBag);
    expect(getStandardConstructorMetadataBag(ExampleController.prototype)).toBe(metadataBag);
    expect(getStandardConstructorMetadataRecord<{ basePath: string }>(
      ExampleController.prototype,
      standardMetadataKeys.controller,
    )).toEqual({ basePath: '/users' });
    expect(getStandardConstructorMetadataMap(ExampleController.prototype, standardMetadataKeys.injection)).toBe(injectionMetadata);
  });

  it('ignores non-object standard metadata payloads', () => {
    class ExampleController {}

    Object.defineProperty(ExampleController, ensureMetadataSymbol(), {
      configurable: true,
      value: 'invalid metadata',
    });

    expect(getStandardMetadataBag(ExampleController)).toBeUndefined();
    expect(getStandardConstructorMetadataBag(ExampleController.prototype)).toBeUndefined();
  });

  it('does not retain caller-owned module metadata arrays across partial writes', () => {
    class ExampleModule {}

    const imports = ['SharedModule'];

    defineModuleMetadata(ExampleModule, {
      imports,
    });
    imports.push('MutatedModule');
    defineModuleMetadata(ExampleModule, {
      providers: ['LoggerProvider'],
    });

    expect(getModuleMetadata(ExampleModule)).toEqual({
      controllers: undefined,
      exports: undefined,
      global: undefined,
      imports: ['SharedModule'],
      middleware: undefined,
      providers: ['LoggerProvider'],
    });
  });
});
