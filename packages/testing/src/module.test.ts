import { getModuleMetadata, Inject, Module, Scope as ScopeDecorator } from '@fluojs/core';
import type { CallHandler, Converter, Dispatcher, Guard, Interceptor, InterceptorContext, Middleware, MiddlewareContext, Next, RequestObserver } from '@fluojs/http';
import { Controller, FromCookie, FromQuery, Get, Post, type RequestContext, RequestDto, UseGuards, UseInterceptors, Version, VersioningType } from '@fluojs/http';
import type { ExceptionFilterHandler } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';
import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import { makeRequest } from './http.js';
import {
  extractModuleControllers,
  extractModuleImports,
  extractModuleProviders,
  Test,
} from './index.js';
import { asMock, PrototypeMock, ShallowMock, mockToken } from './mock.js';

describe('Test static factory', () => {
  it('is a class that owns testing module creation', () => {
    expect(Test).toBeTypeOf('function');
  });
});

describe('explicit provider overrides', () => {
  it('preserves a provider-shaped literal through useValue', async () => {
    const token = Symbol('literal');
    const literal = { provide: token, useValue: 'application data' };
    class AppModule {}

    const testingModule = await Test.createTestingModule({ rootModule: AppModule })
      .overrideProvider(token)
      .useValue(literal)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(testingModule.get(token)).toBe(literal);
    });
  });

  it('preserves a class constructor literal through useValue', async () => {
    const token = Symbol('literal-constructor');
    class LiteralValue {}
    class AppModule {}

    const testingModule = await Test.createTestingModule({ rootModule: AppModule })
      .overrideProvider(token)
      .useValue(LiteralValue)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(testingModule.get(token)).toBe(LiteralValue);
    });
  });
});

@Controller('/users')
class UserController {
  @Post('/')
  async createUser(_: undefined, context: RequestContext) {
    return {
      body: context.request.body,
      headers: context.request.headers,
      query: context.request.query,
    };
  }

  @Get('/me')
  async getMe(_: undefined, context: RequestContext) {
    return context.principal;
  }
}

@Module({
  controllers: [UserController],
})
class AppModule {}

describe('@fluojs/testing', () => {
  it('exposes Test.createTestingModule for NestJS-style module builder access', async () => {
    const TOKEN = Symbol('token');

    @Module({
      providers: [{ provide: TOKEN, useValue: 'from-test-namespace' }],
    })
    class NamespaceModule {}

    const testingModule = await Test.createTestingModule({
      rootModule: NamespaceModule,
    }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(testingModule.get<string>(TOKEN)).toBe('from-test-namespace');
    });
  });

  it('creates a testing module and resolves providers from the module graph', async () => {
    class Logger {
      readonly name = 'logger';
    }

    @Inject(Logger)
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({
      rootModule: ServiceModule,
    }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const service = await testingModule.resolve<UserService>(UserService);

      expect(testingModule.has(UserService)).toBe(true);
      expect(service.logger.name).toBe('logger');
    });
  });

  it('runs bootstrap lifecycle hooks when compiling a testing module', async () => {
    const events: string[] = [];

    class LifecycleService {
      onModuleInit() {
        events.push('service:init');
      }

      onApplicationBootstrap() {
        events.push('service:bootstrap');
      }
    }

    @Inject(LifecycleService)
    class LifecycleConsumer {
      constructor(readonly service: LifecycleService) {}

      onModuleInit() {
        events.push('consumer:init');
      }

      onApplicationBootstrap() {
        events.push('consumer:bootstrap');
      }
    }

    @Module({ providers: [LifecycleService, LifecycleConsumer] })
    class LifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: LifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(await testingModule.resolve(LifecycleConsumer)).toBeInstanceOf(LifecycleConsumer);
      expect(events).toEqual(['service:init', 'consumer:init', 'service:bootstrap', 'consumer:bootstrap']);
    });
  });

  it('disposes successfully compiled module containers after use', async () => {
    const events: string[] = [];

    class DisposableService {
      onDestroy() {
        events.push('disposed');
      }
    }

    @Module({ providers: [DisposableService] })
    class DisposableModule {}

    const testingModule = await Test.createTestingModule({ rootModule: DisposableModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      defer(() => testingModule.container.dispose());
      expect(await testingModule.resolve(DisposableService)).toBeInstanceOf(DisposableService);
    });

    expect(events).toEqual(['disposed']);
  });

  it('preserves test and disposal failures together', async () => {
    const testError = new Error('test assertion failed');
    const disposeError = new Error('testing module disposal failed');

    class DisposableService {
      onDestroy() {
        throw disposeError;
      }
    }

    @Module({ providers: [DisposableService] })
    class DisposableModule {}

    const result = await withCleanup(async (defer) => {
      const testingModule = await Test.createTestingModule({ rootModule: DisposableModule }).compile();
      defer(() => testingModule.container.dispose());
      throw testError;
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    if (result instanceof AggregateError) {
      expect(result.errors).toEqual([testError, disposeError]);
    }
  });

  it('runs bootstrap lifecycle hooks from the effective override provider', async () => {
    const SERVICE_TOKEN = Symbol('service-token');
    const events: string[] = [];

    class ReplacementService {
      onModuleInit() {
        events.push('replacement:init');
      }

      onApplicationBootstrap() {
        events.push('replacement:bootstrap');
      }
    }

    @Module({ providers: [{ provide: SERVICE_TOKEN, useValue: { name: 'original' } }] })
    class LifecycleOverrideModule {}

    const testingModule = await Test.createTestingModule({ rootModule: LifecycleOverrideModule })
      .overrideProvider(SERVICE_TOKEN)
      .useClass(ReplacementService)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(await testingModule.resolve(SERVICE_TOKEN)).toBeInstanceOf(ReplacementService);
      expect(events).toEqual(['replacement:init', 'replacement:bootstrap']);
    });
  });

  it('runs bootstrap lifecycle hooks returned by singleton module factory providers', async () => {
    const FACTORY_TOKEN = Symbol('module-factory-lifecycle-token');
    const events: string[] = [];

    @Module({
      providers: [
        {
          provide: FACTORY_TOKEN,
          useFactory: () => ({
            onModuleInit() {
              events.push('factory:init');
            },
            onApplicationBootstrap() {
              events.push('factory:bootstrap');
            },
          }),
        },
      ],
    })
    class FactoryLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: FactoryLifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(await testingModule.resolve(FACTORY_TOKEN)).toBeDefined();
      expect(events).toEqual(['factory:init', 'factory:bootstrap']);
    });
  });

  it('runs bootstrap lifecycle hooks returned by singleton factory overrides', async () => {
    const FACTORY_TOKEN = Symbol('override-factory-lifecycle-token');
    const events: string[] = [];

    @Module({ providers: [{ provide: FACTORY_TOKEN, useValue: { name: 'original' } }] })
    class FactoryOverrideLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: FactoryOverrideLifecycleModule })
      .overrideProvider(FACTORY_TOKEN)
      .useFactory(() => ({
        onModuleInit() {
          events.push('factory:init');
        },
        onApplicationBootstrap() {
          events.push('factory:bootstrap');
        },
      }))
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(await testingModule.resolve(FACTORY_TOKEN)).toBeDefined();
      expect(events).toEqual(['factory:init', 'factory:bootstrap']);
    });
  });

  it('runs bootstrap lifecycle hooks returned by singleton multi factory providers', async () => {
    const PLUGINS = Symbol('multi-factory-lifecycle-plugins');
    const events: string[] = [];
    const plugin = {
      onModuleInit() {
        events.push('factory:init');
      },
      onApplicationBootstrap() {
        events.push('factory:bootstrap');
      },
    };

    @Module({
      providers: [{ provide: PLUGINS, useFactory: () => plugin, multi: true }],
    })
    class MultiFactoryLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: MultiFactoryLifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(await testingModule.resolve<typeof plugin[]>(PLUGINS)).toEqual([plugin]);
      expect(events).toEqual(['factory:init', 'factory:bootstrap']);
    });
  });

  it('runs bootstrap lifecycle hooks for each singleton multi-provider contribution', async () => {
    const PLUGINS = Symbol('lifecycle-plugins');
    const events: string[] = [];

    class PluginA {
      onModuleInit() {
        events.push('a:init');
      }

      onApplicationBootstrap() {
        events.push('a:bootstrap');
      }
    }

    class PluginB {
      onModuleInit() {
        events.push('b:init');
      }

      onApplicationBootstrap() {
        events.push('b:bootstrap');
      }
    }

    @Module({
      providers: [
        { provide: PLUGINS, useClass: PluginA, multi: true },
        { provide: PLUGINS, useClass: PluginB, multi: true },
      ],
    })
    class MultiLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: MultiLifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const plugins = await testingModule.resolve<Array<PluginA | PluginB>>(PLUGINS);

      expect(plugins[0]).toBeInstanceOf(PluginA);
      expect(plugins[1]).toBeInstanceOf(PluginB);
      expect(events).toEqual(['a:init', 'b:init', 'a:bootstrap', 'b:bootstrap']);
    });
  });

  it('runs interleaved multi-provider lifecycle hooks in declared runtime order', async () => {
    const PLUGINS = Symbol('interleaved-lifecycle-plugins');
    const events: string[] = [];

    class FirstPlugin {
      onModuleInit() {
        events.push('first:init');
      }

      onApplicationBootstrap() {
        events.push('first:bootstrap');
      }
    }

    class SingletonService {
      onModuleInit() {
        events.push('singleton:init');
      }

      onApplicationBootstrap() {
        events.push('singleton:bootstrap');
      }
    }

    class SecondPlugin {
      onModuleInit() {
        events.push('second:init');
      }

      onApplicationBootstrap() {
        events.push('second:bootstrap');
      }
    }

    @Module({
      providers: [
        { provide: PLUGINS, useClass: FirstPlugin, multi: true },
        SingletonService,
        { provide: PLUGINS, useClass: SecondPlugin, multi: true },
      ],
    })
    class InterleavedLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: InterleavedLifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const plugins = await testingModule.resolve<Array<FirstPlugin | SecondPlugin>>(PLUGINS);

      expect(plugins[0]).toBeInstanceOf(FirstPlugin);
      expect(plugins[1]).toBeInstanceOf(SecondPlugin);
      expect(events).toEqual([
        'first:init',
        'singleton:init',
        'second:init',
        'first:bootstrap',
        'singleton:bootstrap',
        'second:bootstrap',
      ]);
    });
  });

  it('runs singleton multi-provider lifecycle hooks when another contribution is request scoped', async () => {
    const PLUGINS = Symbol('mixed-scope-lifecycle-plugins');
    const events: string[] = [];

    class SingletonPlugin {
      onModuleInit() {
        events.push('singleton:init');
      }

      onApplicationBootstrap() {
        events.push('singleton:bootstrap');
      }
    }

    class RequestPlugin {
      onModuleInit() {
        events.push('request:init');
      }

      onApplicationBootstrap() {
        events.push('request:bootstrap');
      }
    }

    @Module({
      providers: [
        { provide: PLUGINS, useClass: SingletonPlugin, multi: true },
        { provide: PLUGINS, scope: 'request', useClass: RequestPlugin, multi: true },
      ],
    })
    class MixedScopeMultiLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: MixedScopeMultiLifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      expect(testingModule).toBeDefined();

      expect(events).toEqual(['singleton:init', 'singleton:bootstrap']);
    });
  });

  it('runs bootstrap lifecycle hooks from lifecycle-bearing useValue overrides', async () => {
    const SERVICE_TOKEN = Symbol('service-token');
    const events: string[] = [];
    const replacement = {
      onModuleInit: () => events.push('value:init'),
      onApplicationBootstrap: () => events.push('value:bootstrap'),
    };

    @Module({ providers: [{ provide: SERVICE_TOKEN, useFactory: () => ({ name: 'original' }) }] })
    class LifecycleValueOverrideModule {}

    const testingModule = await Test.createTestingModule({ rootModule: LifecycleValueOverrideModule })
      .overrideProvider(SERVICE_TOKEN)
      .useValue(replacement)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(await testingModule.resolve(SERVICE_TOKEN)).toBe(replacement);
      expect(events).toEqual(['value:init', 'value:bootstrap']);
    });
  });

  it('does not run bootstrap lifecycle hooks for decorated request or transient providers', async () => {
    const events: string[] = [];

    @ScopeDecorator('request')
    class RequestLifecycleService {
      onModuleInit() {
        events.push('request:init');
      }
    }

    @ScopeDecorator('transient')
    class TransientLifecycleService {
      onModuleInit() {
        events.push('transient:init');
      }
    }

    @Module({ providers: [RequestLifecycleService, TransientLifecycleService] })
    class ScopedLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ScopedLifecycleModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(events).toEqual([]);
    });
  });

  it('uses useClass decorator metadata when deciding bootstrap lifecycle scope', async () => {
    const SERVICE_TOKEN = Symbol('service-token');
    const events: string[] = [];

    @ScopeDecorator('transient')
    class TransientReplacementService {
      onModuleInit() {
        events.push('transient:init');
      }
    }

    @ScopeDecorator('request')
    class RequestReplacementService {
      onModuleInit() {
        events.push('request:init');
      }
    }

    @Module({ providers: [{ provide: SERVICE_TOKEN, useClass: TransientReplacementService }] })
    class UseClassScopedLifecycleModule {}

    const testingModule = await Test.createTestingModule({ rootModule: UseClassScopedLifecycleModule })
      .overrideProvider(SERVICE_TOKEN)
      .useClass(RequestReplacementService)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(events).toEqual([]);
    });
  });

  it('shares singleton identity between get() and resolve()', async () => {
    class CounterService {
      count = 0;
    }

    @Module({ providers: [CounterService] })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule }).compile();

    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const syncService = testingModule.get<CounterService>(CounterService);
      syncService.count = 7;

      const asyncService = await testingModule.resolve<CounterService>(CounterService);

      expect(asyncService).toBe(syncService);
      expect(asyncService.count).toBe(7);
    });
  });

  it('preserves singleton and disposal semantics for sync multi-provider get()', async () => {
    const PLUGINS = Symbol('plugins');
    const disposed: string[] = [];

    class PluginA {
      count = 0;

      onDestroy() {
        disposed.push('a');
      }
    }

    class PluginB {
      count = 0;

      onDestroy() {
        disposed.push('b');
      }
    }

    @Module({
      providers: [
        { provide: PLUGINS, useClass: PluginA, multi: true },
        { provide: PLUGINS, useClass: PluginB, multi: true },
      ],
    })
    class MultiProviderModule {}

    const testingModule = await Test.createTestingModule({ rootModule: MultiProviderModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const first = testingModule.get<Array<PluginA | PluginB>>(PLUGINS);
      first[0].count = 1;
      first[1].count = 2;

      const second = testingModule.get<Array<PluginA | PluginB>>(PLUGINS);
      const resolved = await testingModule.resolve<Array<PluginA | PluginB>>(PLUGINS);

      expect(second).not.toBe(first);
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
      expect(resolved[0]).toBe(first[0]);
      expect(resolved[1]).toBe(first[1]);
      expect(resolved.map((plugin) => plugin.count)).toEqual([1, 2]);

      await testingModule.container.dispose();

      expect(disposed).toEqual(['b', 'a']);
    });
  });

  it('cleans up sync singleton instances materialized through get() when the container is disposed', async () => {
    const disposed: string[] = [];

    class SingletonService {
      onDestroy() {
        disposed.push('singleton');
      }
    }

    @Module({ providers: [SingletonService] })
    class SingletonCleanupModule {}

    const testingModule = await Test.createTestingModule({ rootModule: SingletonCleanupModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const service = testingModule.get<SingletonService>(SingletonService);

      expect(service).toBeInstanceOf(SingletonService);

      await testingModule.container.dispose();

      expect(disposed).toEqual(['singleton']);
    });
  });

  it('overrides providers before resolution', async () => {
    class Logger {
      readonly name: string = 'logger';
    }

    @Inject(Logger)
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({
      rootModule: ServiceModule,
    })
      .overrideProvider(Logger)
      .useValue({ name: 'fake-logger' })
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const service = await testingModule.resolve<UserService>(UserService);

      expect(service.logger).toEqual({ name: 'fake-logger' });
    });
  });

  it('supports NestJS-style overrideProvider(token).useValue(value) chain', async () => {
    class Logger {
      readonly name: string = 'logger';
    }

    @Inject(Logger)
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({
      rootModule: ServiceModule,
    })
      .overrideProvider(Logger)
      .useValue({ name: 'nest-style-fake' })
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const service = await testingModule.resolve<UserService>(UserService);

      expect(service.logger).toEqual({ name: 'nest-style-fake' });
      expect(testingModule.get<Logger>(Logger)).toEqual({ name: 'nest-style-fake' });
    });
  });

  it('reports eagerly resolved async providers from get()', async () => {
    const TOKEN = Symbol('async-token');

    @Module({
      providers: [
        {
          provide: TOKEN,
          useFactory: async () => 'async-value',
        },
      ],
    })
    class AsyncProviderModule {}

    const testingModule = await Test.createTestingModule({
      rootModule: AsyncProviderModule,
    }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(() => testingModule.get<string>(TOKEN)).toThrow(/already resolved asynchronously/);
      await expect(testingModule.resolve<string>(TOKEN)).resolves.toBe('async-value');
    });
  });

  it('keeps async factory providers resolve-only after async singleton sync points', async () => {
    const RESOLVE_TOKEN = Symbol('resolve-async-token');
    const RESOLVE_ALL_TOKEN = Symbol('resolve-all-async-token');

    @Module({
      providers: [
        {
          provide: RESOLVE_TOKEN,
          useFactory: async () => 'resolved-async-value',
        },
        {
          provide: RESOLVE_ALL_TOKEN,
          useFactory: async () => 'resolve-all-async-value',
        },
      ],
    })
    class AsyncSingletonModule {}

    const testingModule = await Test.createTestingModule({ rootModule: AsyncSingletonModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      await expect(testingModule.resolve<string>(RESOLVE_TOKEN)).resolves.toBe('resolved-async-value');
      expect(() => testingModule.get<string>(RESOLVE_TOKEN)).toThrow(/already resolved asynchronously/);

      await expect(testingModule.resolveAll<string>([RESOLVE_ALL_TOKEN])).resolves.toEqual(['resolve-all-async-value']);
      expect(() => testingModule.get<string>(RESOLVE_ALL_TOKEN)).toThrow(/already resolved asynchronously/);
    });
  });

  it('promotes sync useFactory singletons after resolve() while preserving identity for get()', async () => {
    const TOKEN = Symbol('sync-factory-token');
    const value = { id: 'sync-factory-value' };

    @Module({
      providers: [
        {
          provide: TOKEN,
          useFactory: () => value,
        },
      ],
    })
    class SyncFactoryModule {}

    const testingModule = await Test.createTestingModule({ rootModule: SyncFactoryModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const resolved = await testingModule.resolve<typeof value>(TOKEN);
      const syncValue = testingModule.get<typeof value>(TOKEN);

      expect(resolved).toBe(value);
      expect(syncValue).toBe(resolved);
    });
  });

  it('promotes classes depending on sync factories after resolve() while preserving get() identity', async () => {
    const TOKEN = Symbol('sync-factory-dependency-token');
    const dependency = { name: 'sync-dependency' };

    @Inject(TOKEN)
    class SyncFactoryConsumer {
      constructor(readonly value: typeof dependency) {}
    }

    @Module({
      providers: [
        {
          provide: TOKEN,
          useFactory: () => dependency,
        },
        SyncFactoryConsumer,
      ],
    })
    class SyncFactoryConsumerModule {}

    const testingModule = await Test.createTestingModule({ rootModule: SyncFactoryConsumerModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const resolved = await testingModule.resolve<SyncFactoryConsumer>(SyncFactoryConsumer);
      const syncConsumer = testingModule.get<SyncFactoryConsumer>(SyncFactoryConsumer);

      expect(resolved.value).toBe(dependency);
      expect(syncConsumer).toBe(resolved);
    });
  });

  it('preserves sync factory promotion when the dependency is first materialized through get()', async () => {
    const TOKEN = Symbol('sync-first-factory-dependency-token');
    const dependency = { name: 'sync-first-dependency' };

    @Inject(TOKEN)
    class SyncFirstFactoryConsumer {
      constructor(readonly value: typeof dependency) {}
    }

    @Module({
      providers: [
        {
          provide: TOKEN,
          useFactory: () => dependency,
        },
        SyncFirstFactoryConsumer,
      ],
    })
    class SyncFirstFactoryConsumerModule {}

    const testingModule = await Test.createTestingModule({ rootModule: SyncFirstFactoryConsumerModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const syncDependency = testingModule.get<typeof dependency>(TOKEN);
      const resolved = await testingModule.resolve<SyncFirstFactoryConsumer>(SyncFirstFactoryConsumer);
      const syncConsumer = testingModule.get<SyncFirstFactoryConsumer>(SyncFirstFactoryConsumer);

      expect(syncDependency).toBe(dependency);
      expect(resolved.value).toBe(syncDependency);
      expect(syncConsumer).toBe(resolved);
    });
  });

  it('keeps classes depending on useExisting aliases to async factories resolve-only after resolve()', async () => {
    const SOURCE = Symbol('async-factory-source-token');
    const ALIAS = Symbol('async-factory-alias-token');

    @Inject(ALIAS)
    class AliasAsyncConsumer {
      constructor(readonly value: string) {}
    }

    @Module({
      providers: [
        {
          provide: SOURCE,
          useFactory: async () => 'async-aliased-value',
        },
        { provide: ALIAS, useExisting: SOURCE },
        AliasAsyncConsumer,
      ],
    })
    class AliasAsyncFactoryModule {}

    const testingModule = await Test.createTestingModule({ rootModule: AliasAsyncFactoryModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const resolved = await testingModule.resolve<AliasAsyncConsumer>(AliasAsyncConsumer);

      expect(resolved.value).toBe('async-aliased-value');
      expect(() => testingModule.get<AliasAsyncConsumer>(AliasAsyncConsumer)).toThrow(/already resolved asynchronously/);
    });
  });

  it('preserves function mocks through useValue', async () => {
    const FUNCTION_TOKEN = Symbol('function-token');
    const mockFn = vi.fn().mockReturnValue('ok');

    const testingModule = await Test.createTestingModule({
      rootModule: AppModule,
    })
      .overrideProvider(FUNCTION_TOKEN)
      .useValue(mockFn)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const resolved = await testingModule.resolve<typeof mockFn>(FUNCTION_TOKEN);

      expect(resolved).toBe(mockFn);
      expect(resolved()).toBe('ok');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  it('supports class constructor overrides via overrideProvider', async () => {
    class Logger {
      readonly name: string = 'logger';
    }

    class FakeLogger {
      readonly name: string = 'fake-logger';
    }

    @Inject(Logger)
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(Logger)
      .useClass(FakeLogger)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const service = await testingModule.resolve<UserService>(UserService);

      expect(service.logger).toBeInstanceOf(FakeLogger);
      expect(service.logger.name).toBe('fake-logger');
    });
  });

  it('preserves provider-shaped values as literals through useValue', async () => {
    const EXPECTED = Symbol('expected-token');
    const OTHER = Symbol('other-token');
    const literal = {
      provide: OTHER,
      useValue: 'value',
    };

    const testingModule = await Test.createTestingModule({ rootModule: AppModule })
      .overrideProvider(EXPECTED)
      .useValue(literal)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(testingModule.get(EXPECTED)).toBe(literal);
    });
  });

  it('supports useExisting provider descriptors in overrideProvider', async () => {
    const SOURCE = Symbol('source-token');
    const TARGET = Symbol('target-token');

    @Module({
      providers: [
        { provide: SOURCE, useValue: 'source-value' },
        { provide: TARGET, useValue: 'target-value' },
      ],
    })
    class AliasModule {}

    const testingModule = await Test.createTestingModule({ rootModule: AliasModule })
      .overrideProvider(TARGET)
      .useExisting(SOURCE)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      await expect(testingModule.resolve<string>(TARGET)).resolves.toBe('source-value');
    });
  });

  it('applies provider overrides before first provider resolution side effects', async () => {
    const TOKEN = Symbol('expensive-token');
    let factoryCallCount = 0;

    class ConsumerService {
      constructor(readonly value: string) {}
    }

    @Module({
      providers: [
        {
          provide: TOKEN,
          useFactory: () => {
            factoryCallCount += 1;
            return 'real';
          },
        },
        {
          provide: ConsumerService,
          inject: [TOKEN],
          useFactory: (value: string) => new ConsumerService(value),
        },
      ],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(TOKEN)
      .useValue('fake')
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      expect(factoryCallCount).toBe(0);

      const consumer = await testingModule.resolve<ConsumerService>(ConsumerService);
      expect(consumer.value).toBe('fake');
      expect(factoryCallCount).toBe(0);
    });
  });

  it('applies overrides through aliases across repeated transient resolutions', async () => {
    const REAL_CONFIG = Symbol('real-config');
    const CONFIG_ALIAS = Symbol('config-alias');

    class ConsumerService {
      constructor(readonly value: string) {}
    }

    @Module({
      providers: [
        { provide: REAL_CONFIG, useValue: 'real' },
        { provide: CONFIG_ALIAS, useExisting: REAL_CONFIG },
        { provide: ConsumerService, scope: 'transient', useClass: ConsumerService, inject: [CONFIG_ALIAS] },
      ],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(REAL_CONFIG)
      .useValue('fake')
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const first = await testingModule.resolve<ConsumerService>(ConsumerService);
      const second = await testingModule.resolve<ConsumerService>(ConsumerService);

      expect(first).not.toBe(second);
      expect(first.value).toBe('fake');
      expect(second.value).toBe('fake');
    });
  });

  it('keeps testing-module overrides from materializing replaced request-scoped factories', async () => {
    const REQUEST_TOKEN = Symbol('request-token');
    let realFactoryCallCount = 0;

    class ConsumerService {
      constructor(readonly value: string) {}
    }

    @Module({
      providers: [
        {
          provide: REQUEST_TOKEN,
          scope: 'request',
          useFactory: () => {
            realFactoryCallCount += 1;
            return 'real-request';
          },
        },
        { provide: ConsumerService, useClass: ConsumerService, inject: [REQUEST_TOKEN] },
      ],
    })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(REQUEST_TOKEN)
      .useValue('fake-request')
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const consumer = await testingModule.resolve<ConsumerService>(ConsumerService);

      expect(consumer.value).toBe('fake-request');
      expect(realFactoryCallCount).toBe(0);
    });
  });

  it('preserves request-scoped testing module provider isolation when no override is applied', async () => {
    let created = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++created;
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ConsumerService {
      constructor(readonly store: RequestStore) {}
    }

    @Module({ providers: [RequestStore, ConsumerService] })
    class ServiceModule {}

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      await expect(testingModule.resolve<ConsumerService>(ConsumerService)).rejects.toThrow('outside request scope');
    });
  });
});

describe('ShallowMock.create', () => {
  it('returns vi.fn() for any accessed method not in the partial', () => {
    interface MyService {
      doSomething(): string;
      doOther(): number;
    }

    const mock = ShallowMock.create<MyService>();

    expect(typeof mock.doSomething).toBe('function');
    expect(typeof mock.doOther).toBe('function');
  });

  it('uses provided partial values over auto-generated mocks', () => {
    interface Counter {
      increment(): number;
      decrement(): number;
    }

    const increment = vi.fn().mockReturnValue(1);
    const mock = ShallowMock.create<Counter>({ increment });

    expect(mock.increment()).toBe(1);
    expect(increment).toHaveBeenCalledOnce();
  });

  it('returns the same auto-generated mock fn across multiple accesses to the same property', () => {
    interface Greeter {
      greet(): string;
    }

    const mock = ShallowMock.create<Greeter>();
    const first = mock.greet;
    const second = mock.greet;

    expect(first).toBe(second);
  });

  it('throws when strict mode reads an undeclared property', () => {
    interface Greeter {
      greet(): string;
    }

    const mock = ShallowMock.create<Greeter>({}, { strict: true });

    expect(() => mock.greet).toThrow(Error);
  });
});

describe('asMock', () => {
  it('casts a vi.fn() to a typed MockInstance without runtime errors', () => {
    const fn = vi.fn().mockReturnValue(42);
    const typed = asMock(fn as () => number);

    typed.mockReturnValue(99);

    expect(fn()).toBe(99);
  });
});

describe('makeRequest', () => {
  it('dispatches a normalized request and captures the response', async () => {
    const dispatcher: Dispatcher = {
      async dispatch(request: any, response: any) {
        expect(request.method).toBe('POST');
        expect(request.path).toBe('/users');
        expect(request.url).toBe('/users?page=1&tag=a&tag=b');
        expect(request.query).toEqual({ page: '1', tag: ['a', 'b'] });
        expect(request.headers).toEqual({ 'x-test': '1' });
        expect(request.body).toEqual({ name: 'Ada' });

        response.setStatus(201);
        response.setHeader('x-powered-by', 'fluo');
        await response.send({ ok: true });
      },
    };

    const result = await makeRequest(dispatcher, {
      method: 'post',
      path: '/users',
      query: { page: '1', tag: ['a', 'b'] },
      headers: { 'x-test': '1' },
      body: { name: 'Ada' },
    });

    expect(result).toEqual({
      status: 201,
      headers: { 'x-powered-by': 'fluo' },
      body: { ok: true },
    });
  });

  it('merges mixed-case Set-Cookie writes under one ordered header', async () => {
    const dispatcher: Dispatcher = {
      async dispatch(_request, response) {
        response.setHeader('Set-Cookie', 'session=alpha; Path=/; HttpOnly');
        response.setHeader('set-cookie', 'theme=dark; Path=/');
        response.setHeader('SET-COOKIE', 'locale=en-US; Path=/');
        await response.send({ ok: true });
      },
    };

    const result = await makeRequest(dispatcher, { path: '/cookies' });

    expect(result.headers).toEqual({
      'Set-Cookie': [
        'session=alpha; Path=/; HttpOnly',
        'theme=dark; Path=/',
        'locale=en-US; Path=/',
      ],
    });
  });
});

describe('Test.createApp', () => {
  it('retries only failed lifecycle cleanup through the test app wrapper', async () => {
    const failedOnDestroy = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('application container destroy failed');
      });
    const siblingOnDestroy = vi.fn();

    class FailingResource {
      onDestroy = failedOnDestroy;
    }

    class SiblingResource {
      onDestroy = siblingOnDestroy;
    }

    @Inject(FailingResource)
    @Inject(SiblingResource)
    @Controller('/close-retry')
    class CloseRetryController {
      constructor(
        private readonly failingResource: FailingResource,
        private readonly siblingResource: SiblingResource,
      ) {}

      @Get('/')
      read() {
        return {
          failing: this.failingResource instanceof FailingResource,
          sibling: this.siblingResource instanceof SiblingResource,
        };
      }
    }

    @Module({
      controllers: [CloseRetryController],
      providers: [FailingResource, SiblingResource],
    })
    class CloseRetryModule {}

    const app = await Test.createApp({ rootModule: CloseRetryModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      await app.request('GET', '/close-retry').send();

      await expect(app.close()).rejects.toThrow('application container destroy failed');
      await expect(app.close()).resolves.toBeUndefined();
      expect(failedOnDestroy).toHaveBeenCalledTimes(2);
      expect(siblingOnDestroy).toHaveBeenCalledOnce();
    });
  });

  it('runs overridden provider HTTP requests through the application lifecycle', async () => {
    const MESSAGE = Symbol('message');
    const events: string[] = [];

    class LifecycleProvider {
      onApplicationBootstrap() {
        events.push('bootstrap');
      }

      onModuleDestroy() {
        events.push('destroy');
      }

      onModuleInit() {
        events.push('init');
      }
    }

    @Inject(MESSAGE)
    @Controller('/overridden-lifecycle')
    class OverriddenLifecycleController {
      constructor(private readonly message: string) {}

      @Get('/')
      read() {
        events.push('handler');
        return { message: this.message };
      }
    }

    @Module({
      controllers: [OverriddenLifecycleController],
      providers: [
        LifecycleProvider,
        { provide: MESSAGE, useValue: 'original' },
      ],
    })
    class OverriddenLifecycleModule {}

    const app = await Test.createApp({
      rootModule: OverriddenLifecycleModule,
      providers: [{ provide: MESSAGE, useValue: 'overridden' }],
    });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request('GET', '/overridden-lifecycle').send();

      expect(response).toMatchObject({ body: { message: 'overridden' }, status: 200 });
    });

    expect(events).toEqual(['init', 'bootstrap', 'handler', 'destroy']);
  });

  it('provides request builder helpers and closes cleanly', async () => {
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(async () => { await expect(app.close()).resolves.toBeUndefined(); });
      const response = await app
        .request('POST', '/users')
        .header('x-test-id', 'k1')
        .query('page', '1')
        .query('tag', ['a', 'b'])
        .body({ name: 'Alice' })
        .send();

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        body: { name: 'Alice' },
        headers: { 'x-test-id': 'k1' },
        query: { page: '1', tag: ['a', 'b'] },
      });
    });
  });

  it('binds cookies from object request inputs', async () => {
    class CookieRequest {
      @FromCookie('session')
      session = '';
    }

    @Controller('/cookies')
    class CookieController {
      @Get('/')
      @RequestDto(CookieRequest)
      read(input: CookieRequest) {
        return { session: input.session };
      }
    }

    @Module({ controllers: [CookieController] })
    class CookieModule {}

    const app = await Test.createApp({ rootModule: CookieModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request({
        path: '/cookies',
        cookies: { session: 'object-request-cookie' },
      }).send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ session: 'object-request-cookie' });
    });
  });

  it('makes close idempotent when cleanup is called more than once', async () => {
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      await expect(app.close()).resolves.toBeUndefined();
      await expect(app.close()).resolves.toBeUndefined();
    });
  });

  it('preserves caller bootstrap middleware when adding test request context', async () => {
    const middlewareCalls: string[] = [];
    const callerMiddleware: Middleware = {
      async handle(_context, next) {
        middlewareCalls.push('caller');
        await next();
      },
    };

    const app = await Test.createApp({
      rootModule: AppModule,
      middleware: [callerMiddleware],
    });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request('GET', '/users/me').send();

      expect(response.status).toBe(200);
      expect(middlewareCalls).toEqual(['caller']);
    });
  });

  it('forwards provider, observer, interceptor, and versioning bootstrap options to the runtime app', async () => {
    const MESSAGE_TOKEN = Symbol('message-token');
    const observerEvents: string[] = [];
    const observer: RequestObserver = {
      onRequestStart() {
        observerEvents.push('start');
      },
      onRequestSuccess() {
        observerEvents.push('success');
      },
    };
    const interceptor: Interceptor = {
      async intercept(_context, next) {
        observerEvents.push('interceptor');
        const result = await next.handle();

        return { wrapped: result };
      },
    };

    @Inject(MESSAGE_TOKEN)
    @Controller('/bootstrap-options')
    class BootstrapOptionsController {
      constructor(private readonly message: string) {}

      @Version('1')
      @Get('/')
      readV1() {
        return { message: 'v1' };
      }

      @Version('2')
      @Get('/')
      readV2() {
        return { message: this.message };
      }
    }

    @Module({ controllers: [BootstrapOptionsController] })
    class BootstrapOptionsModule {}

    const app = await Test.createApp({
      rootModule: BootstrapOptionsModule,
      interceptors: [interceptor],
      observers: [observer],
      providers: [{ provide: MESSAGE_TOKEN, useValue: 'forwarded-provider' }],
      versioning: { header: 'x-api-version', type: VersioningType.HEADER },
    });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request('GET', '/bootstrap-options').header('x-api-version', '2').send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ wrapped: { message: 'forwarded-provider' } });
      expect(observerEvents).toEqual(['start', 'interceptor', 'success']);
    });
  });

  it('forwards converters to the runtime app', async () => {
    class QueryNumberConverter implements Converter {
      convert(value: unknown) {
        return typeof value === 'string' ? Number(value) : value;
      }
    }

    class SearchRequest {
      @FromQuery('page')
      page = 0;
    }

    @Controller('/converted')
    class ConvertedController {
      @Get('/')
      @RequestDto(SearchRequest)
      read(input: SearchRequest) {
        return { page: input.page };
      }
    }

    @Module({ controllers: [ConvertedController] })
    class ConvertedModule {}

    const app = await Test.createApp({
      rootModule: ConvertedModule,
      converters: [new QueryNumberConverter()],
    });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request('GET', '/converted').query('page', '42').send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ page: 42 });
    });
  });

  it('forwards global exception filters to the runtime app', async () => {
    const caughtErrors: unknown[] = [];

    @Controller('/filtered')
    class FilteredController {
      @Get('/boom')
      boom() {
        throw new Error('handled by filter');
      }
    }

    @Module({ controllers: [FilteredController] })
    class FilteredModule {}

    const filter: ExceptionFilterHandler = {
      async catch(error, context) {
        caughtErrors.push(error);
        context.response.setStatus(418);
        await context.response.send({ handled: true });

        return true;
      },
    };

    const app = await Test.createApp({
      rootModule: FilteredModule,
      filters: [filter],
    });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request('GET', '/filtered/boom').send();

      expect(response.status).toBe(418);
      expect(response.body).toEqual({ handled: true });
      expect(caughtErrors).toHaveLength(1);
    });
  });

  it('injects principal into request context for e2e-style calls', async () => {
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app
        .request('GET', '/users/me')
        .principal({
          id: 'user-1',
          roles: ['admin'],
        })
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        subject: 'user-1',
        roles: ['admin'],
        claims: { id: 'user-1' },
      });
    });
  });

  it('dispatches a request directly through the app helper and injects subject-based principal', async () => {
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
    const response = await app.request({
      method: 'GET',
      path: '/users/me',
      principal: {
        subject: 'dispatch-subject',
        roles: ['ops'],
        claims: { tenant: 'edge' },
      },
    }).send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        subject: 'dispatch-subject',
        roles: ['ops'],
        claims: { tenant: 'edge' },
      });
    });
  });

  it('prioritizes subject over id and falls back to default subject when missing', async () => {
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const subjectResponse = await app
        .request('GET', '/users/me')
        .principal({
          subject: 'subject-win',
          id: 'ignored-id',
        })
        .send();

      expect(subjectResponse.body).toEqual({
        subject: 'subject-win',
        claims: { id: 'ignored-id' },
      });

      const idResponse = await app
        .request('GET', '/users/me')
        .principal({
          id: 'legacy-id',
          roles: ['support'],
        })
        .send();

      expect(idResponse.body).toEqual({
        subject: 'legacy-id',
        roles: ['support'],
        claims: { id: 'legacy-id' },
      });

      const fallbackResponse = await app
        .request('GET', '/users/me')
        .principal({
          roles: ['defaulted'],
        })
        .send();

      expect(fallbackResponse.status).toBe(200);
      expect(fallbackResponse.body).toEqual({
        subject: 'test',
        roles: ['defaulted'],
        claims: {},
      });
    });
  });

  it('isolates request-scoped providers for each fluent request', async () => {
    let created = 0;

    @ScopeDecorator('request')
    class RequestCounter {
      readonly id = ++created;
    }

    @Controller('/request-scope')
    class RequestScopeController {
      @Get('/')
      async read(_input: undefined, context: RequestContext) {
        const counter = await context.container.resolve(RequestCounter);
        return { id: counter.id };
      }
    }

    @Module({ controllers: [RequestScopeController], providers: [RequestCounter] })
    class RequestScopeModule {}

    const app = await Test.createApp({ rootModule: RequestScopeModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const requestResponse = await app.request('GET', '/request-scope').send();
      const secondRequestResponse = await app.request({ method: 'GET', path: '/request-scope' }).send();

      expect(requestResponse.status).toBe(200);
      expect(secondRequestResponse.status).toBe(200);
      expect(requestResponse.body).toEqual({ id: 1 });
      expect(secondRequestResponse.body).toEqual({ id: 2 });
    });
  });
});

describe('overrideModule', () => {
  it('swaps an imported module with a replacement before compilation', async () => {
    class RealService {
      value() {
        return 'real';
      }
    }

    class FakeService {
      value() {
        return 'fake';
      }
    }

    @Inject(RealService)
    class ConsumerService {
      constructor(readonly dep: RealService) {}
    }

    @Module({ providers: [RealService], exports: [RealService] })
    class RealModule {}

    @Module({ providers: [{ provide: RealService, useClass: FakeService }], exports: [RealService] })
    class FakeModule {}

    @Module({ imports: [RealModule], providers: [ConsumerService] })
    class RootModule {}

    const testingModule = await Test.createTestingModule({ rootModule: RootModule })
      .overrideModule(RealModule, FakeModule)
      .compile();

    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const consumer = await testingModule.resolve<ConsumerService>(ConsumerService);
      expect(consumer.dep.value()).toBe('fake');
    });
  });

  it('preserves original testing module identity while applying replacements', async () => {
    class RealService {
      value() {
        return 'real';
      }
    }

    class FakeService {
      value() {
        return 'fake';
      }
    }

    @Inject(RealService)
    class ConsumerService {
      constructor(readonly dep: RealService) {}
    }

    @Module({ providers: [RealService], exports: [RealService] })
    class RealModule {}

    @Module({ providers: [{ provide: RealService, useClass: FakeService }], exports: [RealService] })
    class FakeModule {}

    @Module({ imports: [RealModule], providers: [ConsumerService] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule] })
    class RootModule {}

    const beforeFeatureMetadata = getModuleMetadata(FeatureModule);
    const beforeRootMetadata = getModuleMetadata(RootModule);

    const testingModule = await Test.createTestingModule({ rootModule: RootModule })
      .overrideModule(RealModule, FakeModule)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const moduleTypes = testingModule.modules.map((compiledModule) => compiledModule.type);
      const featureModule = testingModule.modules.find((compiledModule) => compiledModule.type === FeatureModule);
      const realModule = testingModule.modules.find((compiledModule) => compiledModule.type === RealModule);
      const consumer = await testingModule.resolve<ConsumerService>(ConsumerService);

      expect(testingModule.rootModule).toBe(RootModule);
      expect(moduleTypes).toContain(FeatureModule);
      expect(moduleTypes).toContain(RealModule);
      expect(moduleTypes).not.toContain(FakeModule);
      expect(moduleTypes).not.toContainEqual(expect.objectContaining({ name: 'PatchedModule' }));
      expect(featureModule?.definition.imports).toEqual([RealModule]);
      expect(realModule?.definition.providers).toEqual([{ provide: RealService, useClass: FakeService }]);
      expect(extractModuleImports(FeatureModule)).toEqual([RealModule]);
      expect(getModuleMetadata(FeatureModule)).toBe(beforeFeatureMetadata);
      expect(getModuleMetadata(RootModule)).toBe(beforeRootMetadata);
      expect(consumer.dep.value()).toBe('fake');
    });
  });

  it('restores module metadata when replacement bootstrap fails', async () => {
    class RealService {
      value() {
        return 'real';
      }
    }

    @Inject(RealService)
    class ConsumerService {
      constructor(readonly dep: RealService) {}
    }

    @Module({ providers: [RealService], exports: [RealService] })
    class RealModule {}

    @Module({ exports: [RealService] })
    class InvalidFakeModule {}

    @Module({ imports: [RealModule], providers: [ConsumerService] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule] })
    class RootModule {}

    const beforeFeatureMetadata = getModuleMetadata(FeatureModule);

    await expect(
      Test.createTestingModule({ rootModule: RootModule })
        .overrideModule(RealModule, InvalidFakeModule)
        .compile(),
    ).rejects.toThrow(/cannot export token/);

    expect(extractModuleImports(FeatureModule)).toEqual([RealModule]);
    expect(getModuleMetadata(FeatureModule)).toBe(beforeFeatureMetadata);

    const testingModule = await Test.createTestingModule({ rootModule: RootModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const consumer = await testingModule.resolve<ConsumerService>(ConsumerService);

      expect(consumer.dep.value()).toBe('real');
    });
  });

  it('validates cycles introduced by replacement metadata without mutating source metadata', async () => {
    @Module({})
    class RealModule {}

    @Module({ imports: [RealModule] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule] })
    class FakeModule {}

    @Module({ imports: [FeatureModule] })
    class RootModule {}

    const beforeFeatureMetadata = getModuleMetadata(FeatureModule);

    await expect(
      Test.createTestingModule({ rootModule: RootModule })
        .overrideModule(RealModule, FakeModule)
        .compile(),
    ).rejects.toThrow(/Circular module import detected for FeatureModule/);

    expect(extractModuleImports(FeatureModule)).toEqual([RealModule]);
    expect(getModuleMetadata(FeatureModule)).toBe(beforeFeatureMetadata);
  });
});

describe('PrototypeMock.create', () => {
  it('wraps every class method in a vi.fn() spy', () => {
    class MailService {
      send(_to: string) {
        return true;
      }
      queue(_msg: string) {
        return 0;
      }
    }

    const mock = PrototypeMock.create(MailService);

    expect(typeof mock.send).toBe('function');
    expect(typeof mock.queue).toBe('function');

    mock.send('test@example.com');
    expect(vi.isMockFunction(mock.send)).toBe(true);
    expect(mock.send.mock.calls).toHaveLength(1);
  });

  it('includes inherited methods from parent classes', () => {
    class Base {
      baseMethod() {
        return 'base';
      }
    }

    class Child extends Base {
      childMethod() {
        return 'child';
      }
    }

    const mock = PrototypeMock.create(Child);

    expect(vi.isMockFunction(mock.baseMethod)).toBe(true);
    expect(vi.isMockFunction(mock.childMethod)).toBe(true);
  });

  it('child method overrides parent method with a single spy', () => {
    class Base {
      method() {
        return 'base';
      }
    }

    class Child extends Base {
      override method() {
        return 'child';
      }
    }

    const mock = PrototypeMock.create(Child);
    expect(vi.isMockFunction(mock.method)).toBe(true);
  });

  it('wraps symbol-keyed methods in a vi.fn() spy', () => {
    const MY_METHOD = Symbol('myMethod');

    class SymbolService {
      [MY_METHOD]() {
        return 42;
      }
    }

    const mock = PrototypeMock.create(SymbolService);

    expect(vi.isMockFunction(mock[MY_METHOD])).toBe(true);

    mock[MY_METHOD]();
    expect(mock[MY_METHOD]).toHaveBeenCalledTimes(1);
  });
});

describe('mockToken', () => {
  it('produces a ValueProvider for the given token and partial', () => {
    const MY_TOKEN = Symbol('MyService');

    interface MyService {
      find(id: string): string;
    }

    const find = vi.fn().mockReturnValue('found');
    const provider = mockToken<MyService>(MY_TOKEN, { find });

    expect(provider.provide).toBe(MY_TOKEN);
    expect(provider.useValue.find('1')).toBe('found');
  });

  it('defaults to an empty object when no partial is given', () => {
    const TOKEN = Symbol('Token');
    const provider = mockToken(TOKEN);

    expect(provider.provide).toBe(TOKEN);
    expect(provider.useValue).toEqual({});
  });

  it('uses mockToken values through the explicit useValue path', async () => {
    const TOKEN = Symbol('Greeter');

    interface Greeter {
      greet(): string;
    }

    class Logger {
      readonly name = 'logger';
    }

    @Inject(Logger)
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({ providers: [Logger, UserService] })
    class ServiceModule {}

    const greet = vi.fn().mockReturnValue('hello from mock');
    const provider = mockToken<Greeter>(TOKEN, { greet });

    const testingModule = await Test.createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(TOKEN)
      .useValue(provider.useValue)
      .compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      const greeter = await testingModule.resolve<Greeter>(TOKEN);
      expect(greeter.greet()).toBe('hello from mock');
    });
  });
});

describe('extractModuleProviders', () => {
  it('returns providers array from module metadata', () => {
    class ServiceA {}
    class ServiceB {}

    @Module({ providers: [ServiceA, ServiceB] })
    class TestModule {}

    const providers = extractModuleProviders(TestModule);

    expect(providers).toHaveLength(2);
    expect(providers).toContain(ServiceA);
    expect(providers).toContain(ServiceB);
  });

  it('returns empty array when module has no providers', () => {
    @Module({})
    class EmptyModule {}

    const providers = extractModuleProviders(EmptyModule);

    expect(providers).toEqual([]);
  });

  it('includes factory and value providers', () => {
    const TOKEN_A = Symbol('TokenA');
    const TOKEN_B = Symbol('TokenB');

    @Module({
      providers: [
        { provide: TOKEN_A, useValue: 'value-a' },
        { provide: TOKEN_B, useFactory: () => 'factory-b' },
      ],
    })
    class ProviderModule {}

    const providers = extractModuleProviders(ProviderModule);

    expect(providers).toHaveLength(2);
    expect(providers[0]).toEqual({ provide: TOKEN_A, useValue: 'value-a' });
    expect(providers[1]).toHaveProperty('provide', TOKEN_B);
    expect(providers[1]).toHaveProperty('useFactory');
  });
});

describe('extractModuleControllers', () => {
  it('returns controllers array from module metadata', () => {
    @Controller('/a')
    class ControllerA {
      @Get('/')
      index() {
        return 'a';
      }
    }

    @Controller('/b')
    class ControllerB {
      @Get('/')
      index() {
        return 'b';
      }
    }

    @Module({ controllers: [ControllerA, ControllerB] })
    class TestModule {}

    const controllers = extractModuleControllers(TestModule);

    expect(controllers).toHaveLength(2);
    expect(controllers).toContain(ControllerA);
    expect(controllers).toContain(ControllerB);
  });

  it('returns empty array when module has no controllers', () => {
    @Module({})
    class EmptyModule {}

    const controllers = extractModuleControllers(EmptyModule);

    expect(controllers).toEqual([]);
  });
});

describe('extractModuleImports', () => {
  it('returns imports array from module metadata', () => {
    @Module({})
    class ChildA {}

    @Module({})
    class ChildB {}

    @Module({ imports: [ChildA, ChildB] })
    class ParentModule {}

    const imports = extractModuleImports(ParentModule);

    expect(imports).toHaveLength(2);
    expect(imports).toContain(ChildA);
    expect(imports).toContain(ChildB);
  });

  it('returns empty array when module has no imports', () => {
    @Module({})
    class RootModule {}

    const imports = extractModuleImports(RootModule);

    expect(imports).toEqual([]);
  });
});

describe('resolveAll', () => {
  it('resolves multiple tokens and returns results in order', async () => {
    const TOKEN_A = Symbol('TokenA');
    const TOKEN_B = Symbol('TokenB');

    @Module({
      providers: [
        { provide: TOKEN_A, useValue: 'value-a' },
        { provide: TOKEN_B, useValue: 'value-b' },
      ],
    })
    class TestModule {}

    const testingModule = await Test.createTestingModule({ rootModule: TestModule }).compile();

    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const [a, b] = await testingModule.resolveAll([TOKEN_A, TOKEN_B]);

      expect(a).toBe('value-a');
      expect(b).toBe('value-b');
    });
  });

  it('throws aggregated error when some tokens fail to resolve', async () => {
    const TOKEN_A = Symbol('TokenA');
    const TOKEN_MISSING = Symbol('TokenMissing');

    @Module({
      providers: [{ provide: TOKEN_A, useValue: 'value-a' }],
    })
    class TestModule {}

    const testingModule = await Test.createTestingModule({ rootModule: TestModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      await expect(testingModule.resolveAll([TOKEN_A, TOKEN_MISSING])).rejects.toThrow(
        /Failed to resolve 1 of 2 tokens/,
      );
    });
  });

  it('includes token names in aggregated error message', async () => {
    const TOKEN_A = Symbol('TokenA');
    const TOKEN_B = Symbol('TokenB');

    @Module({})
    class EmptyModule {}

    const testingModule = await Test.createTestingModule({ rootModule: EmptyModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());

      await expect(testingModule.resolveAll([TOKEN_A, TOKEN_B])).rejects.toThrow(/TokenA/);
      await expect(testingModule.resolveAll([TOKEN_A, TOKEN_B])).rejects.toThrow(/TokenB/);
    });
  });
});
