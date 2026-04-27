import { describe, expect, it, vi } from 'vitest';

import {
  appendClassValidationRule,
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
  getClassValidationRules,
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
  getStandardConstructorMetadataBag,
  getStandardConstructorMetadataMap,
  getStandardConstructorMetadataRecord,
  getStandardMetadataBag,
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

  it('preserves prior module collections across partial writes and returns immutable snapshots', () => {
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

  it('keeps caller-owned useValue payloads mutable inside frozen module provider snapshots', () => {
    const transport = { subscribed: [] as string[] };
    const transports = [transport];

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      providers: [{ provide: 'TRANSPORTS', useValue: transports }],
    });

    const metadata = getModuleMetadata(ExampleModule);
    const provider = metadata?.providers?.[0] as { useValue: typeof transports } | undefined;

    expect(Object.isFrozen(metadata?.providers)).toBe(true);
    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider?.useValue).toBe(transports);
    expect(Object.isFrozen(provider?.useValue)).toBe(false);
    expect(Object.isFrozen(provider?.useValue[0])).toBe(false);

    provider?.useValue.push({ subscribed: [] });
    provider?.useValue[0]?.subscribed.push('UserCreatedEvent');

    expect(transports).toHaveLength(2);
    expect(transport.subscribed).toEqual(['UserCreatedEvent']);
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

  it('returns immutable nested route metadata objects', () => {
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

    expect(Object.isFrozen(metadata?.headers)).toBe(true);
    expect(Object.isFrozen(metadata?.headers?.[0])).toBe(true);
    expect(Object.isFrozen(metadata?.redirect)).toBe(true);
    expect(() => {
      if (metadata?.headers?.[0]) {
        metadata.headers[0].value = 'mutated';
      }
    }).toThrow(TypeError);
    expect(() => {
      if (metadata?.redirect) {
        metadata.redirect.url = '/mutated';
      }
    }).toThrow(TypeError);

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

  it('preserves custom middleware instances while still cloning the module middleware array', () => {
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
    expect(metadata?.middleware).not.toBeUndefined();
    expect(Object.isFrozen(metadata?.middleware)).toBe(true);
    expect(returnedMiddleware && Object.isFrozen(returnedMiddleware)).toBe(false);
    expect(metadata?.middleware).toBe(getModuleMetadata(ExampleModule)?.middleware);
  });

  it('keeps middleware runtime instances mutable inside frozen module metadata snapshots', () => {
    const middleware = {
      calls: 0,
      handle() {
        this.calls += 1;
      },
    };

    class ExampleModule {}

    defineModuleMetadata(ExampleModule, {
      middleware: [middleware],
    });

    const metadata = getModuleMetadata(ExampleModule);
    const returnedMiddleware = metadata?.middleware?.[0] as typeof middleware | undefined;

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.middleware)).toBe(true);
    expect(returnedMiddleware).toBe(middleware);
    expect(Object.isFrozen(returnedMiddleware)).toBe(false);

    returnedMiddleware?.handle();

    expect(middleware.calls).toBe(1);
  });

  it('keeps guard and interceptor runtime instances mutable inside frozen controller and route metadata snapshots', () => {
    const controllerGuard = {
      calls: 0,
      canActivate() {
        this.calls += 1;
        return true;
      },
    };
    const controllerInterceptor = {
      calls: 0,
      intercept() {
        this.calls += 1;
        return 'controller';
      },
    };
    const routeGuard = {
      calls: 0,
      canActivate() {
        this.calls += 1;
        return true;
      },
    };
    const routeInterceptor = {
      calls: 0,
      intercept() {
        this.calls += 1;
        return 'route';
      },
    };

    class ExampleController {
      getUser() {
        return { ok: true };
      }
    }

    defineControllerMetadata(ExampleController, {
      basePath: '/users',
      guards: [controllerGuard],
      interceptors: [controllerInterceptor],
    });
    defineRouteMetadata(ExampleController.prototype, 'getUser', {
      guards: [routeGuard],
      interceptors: [routeInterceptor],
      method: 'GET',
      path: '/:id',
    });

    const controllerMetadata = getControllerMetadata(ExampleController);
    const routeMetadata = getRouteMetadata(ExampleController.prototype, 'getUser');
    const returnedControllerGuard = controllerMetadata?.guards?.[0] as typeof controllerGuard | undefined;
    const returnedControllerInterceptor = controllerMetadata?.interceptors?.[0] as typeof controllerInterceptor | undefined;
    const returnedRouteGuard = routeMetadata?.guards?.[0] as typeof routeGuard | undefined;
    const returnedRouteInterceptor = routeMetadata?.interceptors?.[0] as typeof routeInterceptor | undefined;

    expect(Object.isFrozen(routeMetadata)).toBe(true);
    expect(Object.isFrozen(routeMetadata?.guards)).toBe(true);
    expect(Object.isFrozen(routeMetadata?.interceptors)).toBe(true);
    expect(returnedControllerGuard).toBe(controllerGuard);
    expect(returnedControllerInterceptor).toBe(controllerInterceptor);
    expect(returnedRouteGuard).toBe(routeGuard);
    expect(returnedRouteInterceptor).toBe(routeInterceptor);
    expect(Object.isFrozen(returnedControllerGuard)).toBe(false);
    expect(Object.isFrozen(returnedControllerInterceptor)).toBe(false);
    expect(Object.isFrozen(returnedRouteGuard)).toBe(false);
    expect(Object.isFrozen(returnedRouteInterceptor)).toBe(false);

    returnedControllerGuard?.canActivate();
    returnedControllerInterceptor?.intercept();
    returnedRouteGuard?.canActivate();
    returnedRouteInterceptor?.intercept();

    expect(controllerGuard.calls).toBe(1);
    expect(controllerInterceptor.calls).toBe(1);
    expect(routeGuard.calls).toBe(1);
    expect(routeInterceptor.calls).toBe(1);
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

  it('merges child DI metadata with inherited fallback and returns immutable arrays', () => {
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

  it('reuses the same frozen own class DI metadata snapshot across repeated reads', () => {
    class ExampleService {}

    defineClassDiMetadata(ExampleService, {
      inject: ['LOGGER'],
      scope: 'request',
    });

    const metadata = getOwnClassDiMetadata(ExampleService);

    expect(getOwnClassDiMetadata(ExampleService)).toBe(metadata);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.inject)).toBe(true);
    expect(() => (metadata?.inject as unknown as unknown[]).push('MUTATED')).toThrow(TypeError);
    expect(getOwnClassDiMetadata(ExampleService)).toEqual({
      inject: ['LOGGER'],
      scope: 'request',
    });
  });

  it('ensures Symbol.metadata is available through the exported initializer', () => {
    expect(ensureMetadataSymbol()).toBe((Symbol as typeof Symbol & { metadata?: symbol }).metadata);
  });

  it('returns detached mutable class validation rule clones without mutating stored metadata', () => {
    const validate = vi.fn(() => true);
    const standardRule = { code: 'standard', message: 'Standard rule', validate };
    const storedRule = { code: 'stored', message: 'Stored rule', validate };

    class ExampleDto {}

    Object.defineProperty(ExampleDto, ensureMetadataSymbol(), {
      configurable: true,
      value: {
        [standardMetadataKeys.classValidation]: [standardRule],
      },
    });
    appendClassValidationRule(ExampleDto, storedRule);

    const rules = getClassValidationRules(ExampleDto);

    expect(rules).toEqual([standardRule, storedRule]);
    expect(Object.isFrozen(rules)).toBe(false);
    expect(Object.isFrozen(rules[0])).toBe(false);
    expect(Object.isFrozen(rules[1])).toBe(false);

    const mutableRules = rules as unknown as typeof storedRule[];
    mutableRules[0]!.code = 'mutated-standard';
    mutableRules[1]!.code = 'mutated-stored';
    mutableRules.push({ code: 'extra', message: 'Extra rule', validate });

    expect(getClassValidationRules(ExampleDto)).toEqual([standardRule, storedRule]);
  });

  it('uses a runtime-installed Symbol.metadata instead of a stale fallback symbol', () => {
    const symbolConstructor = Symbol as typeof Symbol & { metadata?: symbol };
    const previousMetadataDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const runtimeMetadataSymbol = Symbol('runtime.metadata');

    try {
      Object.defineProperty(Symbol, 'metadata', {
        configurable: true,
        value: undefined,
      });

      expect(ensureMetadataSymbol()).toBe(Symbol.for('fluo.symbol.metadata'));

      Object.defineProperty(Symbol, 'metadata', {
        configurable: true,
        value: runtimeMetadataSymbol,
      });

      expect(ensureMetadataSymbol()).toBe(runtimeMetadataSymbol);
    } finally {
      if (previousMetadataDescriptor) {
        Object.defineProperty(Symbol, 'metadata', previousMetadataDescriptor);
      } else {
        delete symbolConstructor.metadata;
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

  it('reuses frozen metadata snapshots across repeated hot-path reads', () => {
    class Repository {}
    class Cache {}
    const providerFactory = vi.fn(() => new Repository());
    const modules: Function[] = [];

    for (let index = 0; index < 250; index += 1) {
      class StressModule {}

      defineModuleMetadata(StressModule, {
        imports: modules.slice(Math.max(0, modules.length - 3)),
        providers: [Repository, Cache, { provide: `REPOSITORY_${index}`, useFactory: providerFactory }],
      });
      modules.push(StressModule);
    }

    class BaseStressService {}

    defineClassDiMetadata(BaseStressService, {
      scope: 'request',
    });

    class StressService extends BaseStressService {}

    defineClassDiMetadata(StressService, {
      inject: [Repository, Cache],
    });

    const firstModuleRead = getModuleMetadata(modules.at(-1) as Function);
    const firstDiRead = getClassDiMetadata(StressService);

    for (let index = 0; index < 1_000; index += 1) {
      expect(getModuleMetadata(modules.at(-1) as Function)).toBe(firstModuleRead);
      expect(getClassDiMetadata(StressService)).toBe(firstDiRead);
    }

    expect(providerFactory).not.toHaveBeenCalled();
    expect(Object.isFrozen(firstModuleRead)).toBe(true);
    expect(Object.isFrozen(firstModuleRead?.providers)).toBe(true);
    expect(firstDiRead).toEqual({
      inject: [Repository, Cache],
      scope: 'request',
    });
    expect(Object.isFrozen(firstDiRead)).toBe(true);
    expect(Object.isFrozen(firstDiRead?.inject)).toBe(true);
  });
});
