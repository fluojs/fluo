import { describe, expect, it, vi } from 'vitest';

import { Global, Inject, Module } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';

import { bootstrapModule, FluoFactory } from './bootstrap.js';
import { DuplicateProviderError, ModuleGraphError, ModuleInjectionMetadataError, ModuleVisibilityError } from './errors.js';
import type { PlatformComponent, PlatformState } from './platform-contract.js';
import { HTTP_APPLICATION_ADAPTER, PLATFORM_SHELL } from './tokens.js';
import type { MicroserviceRuntime } from './types.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

describe('bootstrapModule', () => {
  it('boots a simple module graph deterministically', () => {
    class Logger {}

    class SharedModule {}
    defineModuleMetadata(SharedModule, {
      exports: [Logger],
      providers: [Logger],
    });

    @Inject(Logger)
    class AppService {
      constructor(readonly logger: Logger) {}
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [SharedModule],
      providers: [AppService],
    });

    const result = bootstrapModule(AppModule);

    expect(result.modules.map((compiledModule) => compiledModule.type.name)).toEqual([
      'SharedModule',
      'AppModule',
    ]);
  });

  it('fails when a provider is not exported across modules', () => {
    class InternalRepository {}

    class DataModule {}
    defineModuleMetadata(DataModule, {
      providers: [InternalRepository],
    });

    @Inject(InternalRepository)
    class BillingService {}

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      imports: [DataModule],
      providers: [BillingService],
    });

    expect(() => bootstrapModule(BillingModule)).toThrow('not visible through a global module');
  });

  it('fails when a provider declares constructor dependencies without @Inject metadata', () => {
    class Logger {}

    class BillingService {
      constructor(readonly logger: Logger) {}
    }

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      providers: [Logger, BillingService],
    });

    expect(() => bootstrapModule(BillingModule)).toThrow(ModuleInjectionMetadataError);
    expect(() => bootstrapModule(BillingModule)).toThrow('Provider BillingService in module BillingModule');
  });

  it('fails when a class provider inject list is shorter than its constructor arity', () => {
    class Logger {}
    class Metrics {}

    class BillingService {
      constructor(
        readonly logger: Logger,
        readonly metrics: Metrics,
      ) {}
    }

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      providers: [
        Logger,
        Metrics,
        {
          provide: BillingService,
          inject: [Logger],
          useClass: BillingService,
        },
      ],
    });

    expect(() => bootstrapModule(BillingModule)).toThrow(ModuleInjectionMetadataError);
    expect(() => bootstrapModule(BillingModule)).toThrow('constructor parameter #1');
  });

  it('fails when a controller declares constructor dependencies without @Inject metadata', () => {
    class Logger {}

    class BillingController {
      constructor(readonly logger: Logger) {}
    }

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      controllers: [BillingController],
      providers: [Logger],
    });

    expect(() => bootstrapModule(BillingModule)).toThrow(ModuleInjectionMetadataError);
    expect(() => bootstrapModule(BillingModule)).toThrow('Controller BillingController in module BillingModule');
  });

  it('allows class providers to satisfy constructor dependencies with provider.inject', () => {
    class Logger {}

    class BillingService {
      constructor(readonly logger: Logger) {}
    }

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      providers: [
        Logger,
        {
          provide: BillingService,
          inject: [Logger],
          useClass: BillingService,
        },
      ],
    });

    expect(() => bootstrapModule(BillingModule)).not.toThrow();
  });

  it('allows subclasses to inherit @Inject metadata for dependency validation', () => {
    class Logger {}

    @Inject(Logger)
    class BaseBillingService {
      constructor(readonly logger: Logger) {}
    }

    class BillingService extends BaseBillingService {}

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      providers: [Logger, BillingService],
    });

    expect(() => bootstrapModule(BillingModule)).not.toThrow();
  });

  it('still enforces own @Inject metadata for subclass-only constructor parameters', () => {
    class Logger {}
    class Metrics {}

    @Inject(Logger)
    class BaseBillingService {
      constructor(readonly logger: Logger) {}
    }

    class BillingService extends BaseBillingService {
      constructor(
        logger: Logger,
        readonly metrics: Metrics,
      ) {
        super(logger);
      }
    }

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      providers: [Logger, Metrics, BillingService],
    });

    expect(() => bootstrapModule(BillingModule)).toThrow(ModuleInjectionMetadataError);
    expect(() => bootstrapModule(BillingModule)).toThrow('constructor parameter #1');
  });

  it('allows exported providers from a global module without direct imports', () => {
    class Logger {}

    @Global()
    @Module({
      exports: [Logger],
      providers: [Logger],
    })
    class SharedModule {}

    @Inject(Logger)
    class BillingService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      imports: [SharedModule],
    })
    class RootModule {}

    @Module({
      providers: [BillingService],
    })
    class BillingModule {}

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [RootModule, BillingModule],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });
});

describe('bootstrapModule middleware DI registration', () => {
  it('registers middleware class tokens in the DI container', async () => {
    class LoggingMiddleware {
      async handle(_: unknown, next: () => Promise<void>) {
        await next();
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      middleware: [LoggingMiddleware],
    });

    const result = bootstrapModule(AppModule);
    const instance = await result.container.resolve(LoggingMiddleware);

    expect(instance).toBeInstanceOf(LoggingMiddleware);
  });

  it('registers MiddlewareRouteConfig middleware constructor in the DI container', async () => {
    class AuthMiddleware {
      async handle(_: unknown, next: () => Promise<void>) {
        await next();
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      middleware: [{ middleware: AuthMiddleware, routes: ['/users'] }],
    });

    const result = bootstrapModule(AppModule);
    const instance = await result.container.resolve(AuthMiddleware);

    expect(instance).toBeInstanceOf(AuthMiddleware);
  });

  it('silently skips plain object middleware (factory pattern)', () => {
    const factoryMiddleware = {
      handle: async (_: unknown, next: () => Promise<void>) => next(),
    };

    class AppModule {}
    defineModuleMetadata(AppModule, {
      middleware: [factoryMiddleware],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });

  it('does not throw when same class appears in both middleware and providers', () => {
    class LoggingMiddleware {
      async handle(_: unknown, next: () => Promise<void>) {
        await next();
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      middleware: [LoggingMiddleware],
      providers: [LoggingMiddleware],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });
});

describe('bootstrapModule duplicate provider detection', () => {
  it('warns but continues when the same token is registered in two modules and policy is "warn"', () => {
    class SharedService {}

    class ModuleA {}
    defineModuleMetadata(ModuleA, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class ModuleB {}
    defineModuleMetadata(ModuleB, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class RootModule {}
    defineModuleMetadata(RootModule, {
      imports: [ModuleA, ModuleB],
    });

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: warnFn };

    expect(() => bootstrapModule(RootModule, { duplicateProviderPolicy: 'warn', logger })).not.toThrow();
    expect(warnFn).toHaveBeenCalledOnce();
    expect(warnFn.mock.calls[0]![0]).toContain('SharedService');
  });

  it('keeps the latest provider registration when policy is "warn"', async () => {
    const SHARED = Symbol('shared-token');

    class ModuleA {}
    defineModuleMetadata(ModuleA, {
      providers: [{ provide: SHARED, useValue: 'from-a' }],
    });

    class ModuleB {}
    defineModuleMetadata(ModuleB, {
      providers: [{ provide: SHARED, useValue: 'from-b' }],
    });

    class RootModule {}
    defineModuleMetadata(RootModule, {
      imports: [ModuleA, ModuleB],
    });

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: warnFn };
    const result = bootstrapModule(RootModule, { duplicateProviderPolicy: 'warn', logger });

    await expect(result.container.resolve<string>(SHARED)).resolves.toBe('from-b');
    expect(warnFn).toHaveBeenCalledOnce();
  });

  it('warns when no policy is specified (default is "warn")', () => {
    class SharedService {}

    class ModuleA {}
    defineModuleMetadata(ModuleA, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class ModuleB {}
    defineModuleMetadata(ModuleB, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class RootModule {}
    defineModuleMetadata(RootModule, {
      imports: [ModuleA, ModuleB],
    });

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: warnFn };

    expect(() => bootstrapModule(RootModule, { logger })).not.toThrow();
    expect(warnFn).toHaveBeenCalledOnce();
  });

  it('throws DuplicateProviderError when the same token is registered in two modules and policy is "throw"', () => {
    class SharedService {}

    class ModuleA {}
    defineModuleMetadata(ModuleA, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class ModuleB {}
    defineModuleMetadata(ModuleB, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class RootModule {}
    defineModuleMetadata(RootModule, {
      imports: [ModuleA, ModuleB],
    });

    expect(() => bootstrapModule(RootModule, { duplicateProviderPolicy: 'throw' })).toThrow(DuplicateProviderError);
    expect(() => bootstrapModule(RootModule, { duplicateProviderPolicy: 'throw' })).toThrow('SharedService');
  });

  it('silently allows duplicate tokens when policy is "ignore"', () => {
    class SharedService {}

    class ModuleA {}
    defineModuleMetadata(ModuleA, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class ModuleB {}
    defineModuleMetadata(ModuleB, {
      providers: [SharedService],
      exports: [SharedService],
    });

    class RootModule {}
    defineModuleMetadata(RootModule, {
      imports: [ModuleA, ModuleB],
    });

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: warnFn };

    expect(() => bootstrapModule(RootModule, { duplicateProviderPolicy: 'ignore', logger })).not.toThrow();
    expect(warnFn).not.toHaveBeenCalled();
  });

  it('keeps the latest provider registration when policy is "ignore"', async () => {
    const SHARED = Symbol('shared-token');

    class ModuleA {}
    defineModuleMetadata(ModuleA, {
      providers: [{ provide: SHARED, useValue: 'from-a' }],
    });

    class ModuleB {}
    defineModuleMetadata(ModuleB, {
      providers: [{ provide: SHARED, useValue: 'from-b' }],
    });

    class RootModule {}
    defineModuleMetadata(RootModule, {
      imports: [ModuleA, ModuleB],
    });

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: warnFn };
    const result = bootstrapModule(RootModule, { duplicateProviderPolicy: 'ignore', logger });

    await expect(result.container.resolve<string>(SHARED)).resolves.toBe('from-b');
    expect(warnFn).not.toHaveBeenCalled();
  });

  it('does not report duplicates for runtime providers passed via options.providers', () => {
    class SharedService {}

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [SharedService],
    });

    const warnFn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: warnFn };

    // SharedService is registered both as a runtime provider and a module provider —
    // only module-level duplicates trigger the policy.
    expect(() =>
      bootstrapModule(AppModule, {
        duplicateProviderPolicy: 'warn',
        logger,
        providers: [SharedService],
      }),
    ).not.toThrow();
    expect(warnFn).not.toHaveBeenCalled();
  });
});

describe('bootstrapModule requiredConstructorParameters fix', () => {
  it('does not throw for a class decorated with @Inject() (explicit empty inject list)', () => {
    @Inject()
    class ZeroDependencyService {}

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [ZeroDependencyService],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });

  it('does not throw for a class decorated with @Inject(Token) that also has a default parameter', () => {
    class Logger {}

    @Inject(Logger)
    class AppService {
      constructor(
        readonly logger: Logger,
        readonly timeout: number = 5000,
      ) {}
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [Logger, AppService],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });

  it('keeps supporting the legacy array syntax during the staged migration', () => {
    class Logger {}

    @Inject(Logger)
    class LegacyAppService {
      constructor(readonly logger: Logger) {}
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [Logger, LegacyAppService],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });
});

describe('FluoFactory.createApplicationContext', () => {
  it('boots providers without creating the HTTP application adapter', async () => {
    class AppService {
      readonly marker = 'ok';
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [AppService],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });

    await expect(context.get(AppService)).resolves.toBeInstanceOf(AppService);
    await expect(context.get(HTTP_APPLICATION_ADAPTER)).rejects.toThrow('No provider registered');
    await expect(context.get(PLATFORM_SHELL)).resolves.toBeDefined();

    await context.close();
  });

  it('memoizes ApplicationContext.get() for singleton tokens', async () => {
    class AppService {}

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [AppService],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });
    const resolve = vi.spyOn(context.container, 'resolve');

    const first = await context.get(AppService);
    const second = await context.get(AppService);

    expect(first).toBe(second);
    expect(resolve).toHaveBeenCalledTimes(1);

    await context.close();
  });

  it('recomputes ApplicationContext.get() cacheability after singleton provider overrides', async () => {
    class AppService {}

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [AppService],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });

    const singleton = await context.get(AppService);
    expect(await context.get(AppService)).toBe(singleton);

    context.container.override({
      provide: AppService,
      scope: 'transient',
      useFactory: () => ({ marker: Symbol('app-service') }) as AppService,
    });

    const firstOverride = await context.get(AppService);
    const secondOverride = await context.get(AppService);

    expect(firstOverride).not.toBe(singleton);
    expect(secondOverride).not.toBe(singleton);
    expect(firstOverride).not.toBe(secondOverride);

    await context.close();
  });

  it.each(['warn', 'ignore'] as const)(
    'does not cache losing duplicate root singleton providers when policy is %s',
    async (duplicateProviderPolicy) => {
      const CACHE_TOKEN = Symbol('cache-token');
      let resolutionCount = 0;

      class AppModule {}
      defineModuleMetadata(AppModule, {
        providers: [
          {
            provide: CACHE_TOKEN,
            useFactory: () => ({ id: 0 }),
          },
          {
            provide: CACHE_TOKEN,
            scope: 'transient',
            useFactory: () => ({ id: ++resolutionCount }),
          },
        ],
      });

      const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const context = await FluoFactory.createApplicationContext(AppModule, {
        duplicateProviderPolicy,
        logger,
      });

      const first = await context.get<{ id: number }>(CACHE_TOKEN);
      const second = await context.get<{ id: number }>(CACHE_TOKEN);

      expect(first).toEqual({ id: 1 });
      expect(second).toEqual({ id: 2 });
      expect(first).not.toBe(second);

      await context.close();
    },
  );

  it.each(['warn', 'ignore'] as const)(
    'does not cache losing duplicate runtime singleton providers when policy is %s',
    async (duplicateProviderPolicy) => {
      const CACHE_TOKEN = Symbol('runtime-cache-token');
      let resolutionCount = 0;

      class AppModule {}
      defineModuleMetadata(AppModule, {});

      const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const context = await FluoFactory.createApplicationContext(AppModule, {
        duplicateProviderPolicy,
        logger,
        providers: [
          {
            provide: CACHE_TOKEN,
            useFactory: () => ({ id: 0 }),
          },
          {
            provide: CACHE_TOKEN,
            scope: 'transient',
            useFactory: () => ({ id: ++resolutionCount }),
          },
        ],
      });

      const first = await context.get<{ id: number }>(CACHE_TOKEN);
      const second = await context.get<{ id: number }>(CACHE_TOKEN);

      expect(first).toEqual({ id: 1 });
      expect(second).toEqual({ id: 2 });
      expect(first).not.toBe(second);

      await context.close();
    },
  );

  it('does not memoize multi-provider tokens through ApplicationContext.get()', async () => {
    const MULTI_TOKEN = Symbol('context-multi-token');
    const firstContribution = { id: 'first' };
    const secondContribution = { id: 'second' };

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          multi: true,
          provide: MULTI_TOKEN,
          useFactory: () => firstContribution,
        },
        {
          multi: true,
          provide: MULTI_TOKEN,
          useFactory: () => secondContribution,
        },
      ],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });
    const resolve = vi.spyOn(context.container, 'resolve');

    const first = await context.get<Array<{ id: string }>>(MULTI_TOKEN);
    const second = await context.get<Array<{ id: string }>>(MULTI_TOKEN);

    expect(first).toEqual([firstContribution, secondContribution]);
    expect(second).toEqual([firstContribution, secondContribution]);
    expect(first).not.toBe(second);
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toBe(second[1]);
    expect(resolve).toHaveBeenCalledTimes(2);

    await context.close();
  });

  it('does not memoize multi-provider tokens through Application.get()', async () => {
    const MULTI_TOKEN = Symbol('application-multi-token');
    const moduleContribution = { id: 'module' };
    const runtimeContribution = { id: 'runtime' };

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          multi: true,
          provide: MULTI_TOKEN,
          useFactory: () => moduleContribution,
        },
      ],
    });

    const app = await FluoFactory.create(AppModule, {
      providers: [
        {
          multi: true,
          provide: MULTI_TOKEN,
          useFactory: () => runtimeContribution,
        },
      ],
    });
    const resolve = vi.spyOn(app.container, 'resolve');

    const first = await app.get<Array<{ id: string }>>(MULTI_TOKEN);
    const second = await app.get<Array<{ id: string }>>(MULTI_TOKEN);

    expect(first).toEqual([runtimeContribution, moduleContribution]);
    expect(second).toEqual([runtimeContribution, moduleContribution]);
    expect(first).not.toBe(second);
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toBe(second[1]);
    expect(resolve).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it('resolves independent singleton lifecycle providers concurrently before ordered hooks', async () => {
    const events: string[] = [];
    const FIRST = Symbol('first');
    const SECOND = Symbol('second');
    const firstCanResolve = createDeferred<void>();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: FIRST,
          async useFactory() {
            events.push('first:resolve:start');
            await firstCanResolve.promise;
            events.push('first:resolve:end');
            return {
              onModuleInit() {
                events.push('first:init');
              },
            };
          },
        },
        {
          provide: SECOND,
          useFactory() {
            events.push('second:resolve');
            firstCanResolve.resolve();
            return {
              onModuleInit() {
                events.push('second:init');
              },
            };
          },
        },
      ],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });

    expect(events).toEqual([
      'first:resolve:start',
      'second:resolve',
      'first:resolve:end',
      'first:init',
      'second:init',
    ]);

    await context.close();
  });

  it('cleans up lifecycle instances resolved before parallel provider resolution failure', async () => {
    const events: string[] = [];
    const SUCCESS = Symbol('success');
    const FAILING = Symbol('failing');

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: SUCCESS,
          async useFactory() {
            events.push('success:resolve');

            return {
              onApplicationShutdown(signal?: string) {
                events.push(`success:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('success:destroy');
              },
            };
          },
        },
        {
          provide: FAILING,
          async useFactory() {
            events.push('failing:resolve');
            throw new Error('lifecycle provider failed');
          },
        },
      ],
    });

    await expect(FluoFactory.createApplicationContext(AppModule, {
    })).rejects.toThrow('lifecycle provider failed');

    expect(events).toEqual([
      'success:resolve',
      'failing:resolve',
      'success:destroy',
      'success:shutdown:bootstrap-failed',
    ]);
  });

  it('runs startup and shutdown lifecycle hooks around close()', async () => {
    const events: string[] = [];

    class AppService {
      onApplicationBootstrap() {
        events.push('app:bootstrap');
      }

      onApplicationShutdown(signal?: string) {
        events.push(`app:shutdown:${signal ?? 'none'}`);
      }

      onModuleDestroy() {
        events.push('module:destroy');
      }

      onModuleInit() {
        events.push('module:init');
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [AppService],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });

    expect(events).toEqual(['module:init', 'app:bootstrap']);
    await context.close('SIGTERM');
    await context.close('SIGTERM');

    expect(events).toEqual([
      'module:init',
      'app:bootstrap',
      'module:destroy',
      'app:shutdown:SIGTERM',
    ]);
  });

  it('runs lifecycle hooks exposed by singleton useValue providers', async () => {
    const events: string[] = [];
    const LIFECYCLE_VALUE = Symbol('lifecycle-value');

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: LIFECYCLE_VALUE,
          useValue: {
            onApplicationBootstrap() {
              events.push('value:bootstrap');
            },
            onApplicationShutdown(signal?: string) {
              events.push(`value:shutdown:${signal ?? 'none'}`);
            },
            onModuleDestroy() {
              events.push('value:destroy');
            },
            onModuleInit() {
              events.push('value:init');
            },
          },
        },
      ],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });

    expect(events).toEqual(['value:init', 'value:bootstrap']);

    await context.close('SIGTERM');

    expect(events).toEqual([
      'value:init',
      'value:bootstrap',
      'value:destroy',
      'value:shutdown:SIGTERM',
    ]);
  });

  it.each(['warn', 'ignore'] as const)(
    'runs lifecycle hooks only on winning duplicate useValue providers when policy is %s',
    async (duplicateProviderPolicy) => {
      const events: string[] = [];
      const LIFECYCLE_VALUE = Symbol('lifecycle-value');

      class AppModule {}
      defineModuleMetadata(AppModule, {
        providers: [
          {
            provide: LIFECYCLE_VALUE,
            useValue: {
              onApplicationBootstrap() {
                events.push('losing:bootstrap');
              },
              onApplicationShutdown(signal?: string) {
                events.push(`losing:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('losing:destroy');
              },
              onModuleInit() {
                events.push('losing:init');
              },
            },
          },
          {
            provide: LIFECYCLE_VALUE,
            useValue: {
              onApplicationBootstrap() {
                events.push('winning:bootstrap');
              },
              onApplicationShutdown(signal?: string) {
                events.push(`winning:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('winning:destroy');
              },
              onModuleInit() {
                events.push('winning:init');
              },
            },
          },
        ],
      });

      const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const context = await FluoFactory.createApplicationContext(AppModule, {
        duplicateProviderPolicy,
        logger,
      });

      expect(events).toEqual(['winning:init', 'winning:bootstrap']);

      await context.close('SIGTERM');

      expect(events).toEqual([
        'winning:init',
        'winning:bootstrap',
        'winning:destroy',
        'winning:shutdown:SIGTERM',
      ]);
    },
  );

  it.each(['warn', 'ignore'] as const)(
    'runs lifecycle hooks only on winning duplicate runtime useValue providers when policy is %s',
    async (duplicateProviderPolicy) => {
      const events: string[] = [];
      const LIFECYCLE_VALUE = Symbol('runtime-lifecycle-value');

      class AppModule {}
      defineModuleMetadata(AppModule, {});

      const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const context = await FluoFactory.createApplicationContext(AppModule, {
        duplicateProviderPolicy,
        logger,
        providers: [
          {
            provide: LIFECYCLE_VALUE,
            useValue: {
              onApplicationBootstrap() {
                events.push('losing:bootstrap');
              },
              onApplicationShutdown(signal?: string) {
                events.push(`losing:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('losing:destroy');
              },
              onModuleInit() {
                events.push('losing:init');
              },
            },
          },
          {
            provide: LIFECYCLE_VALUE,
            useValue: {
              onApplicationBootstrap() {
                events.push('winning:bootstrap');
              },
              onApplicationShutdown(signal?: string) {
                events.push(`winning:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('winning:destroy');
              },
              onModuleInit() {
                events.push('winning:init');
              },
            },
          },
        ],
      });

      expect(events).toEqual(['winning:init', 'winning:bootstrap']);

      await context.close('SIGTERM');

      expect(events).toEqual([
        'winning:init',
        'winning:bootstrap',
        'winning:destroy',
        'winning:shutdown:SIGTERM',
      ]);
    },
  );

  it.each(['warn', 'ignore'] as const)(
    'ignores stale losing lifecycle hooks when the duplicate winner has no hooks and policy is %s',
    async (duplicateProviderPolicy) => {
      const events: string[] = [];
      const LIFECYCLE_VALUE = Symbol('lifecycle-value');

      class AppModule {}
      defineModuleMetadata(AppModule, {
        providers: [
          {
            provide: LIFECYCLE_VALUE,
            useValue: {
              onApplicationBootstrap() {
                events.push('losing:bootstrap');
              },
              onApplicationShutdown(signal?: string) {
                events.push(`losing:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('losing:destroy');
              },
              onModuleInit() {
                events.push('losing:init');
              },
            },
          },
          {
            provide: LIFECYCLE_VALUE,
            useValue: { marker: 'winning-without-hooks' },
          },
        ],
      });

      const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const context = await FluoFactory.createApplicationContext(AppModule, {
        duplicateProviderPolicy,
        logger,
      });

      expect(events).toEqual([]);

      await context.close('SIGTERM');

      expect(events).toEqual([]);
    },
  );

  it.each(['warn', 'ignore'] as const)(
    'ignores stale losing runtime lifecycle hooks when the duplicate winner has no hooks and policy is %s',
    async (duplicateProviderPolicy) => {
      const events: string[] = [];
      const LIFECYCLE_VALUE = Symbol('runtime-lifecycle-value-without-hooks');

      class AppModule {}
      defineModuleMetadata(AppModule, {});

      const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const context = await FluoFactory.createApplicationContext(AppModule, {
        duplicateProviderPolicy,
        logger,
        providers: [
          {
            provide: LIFECYCLE_VALUE,
            useValue: {
              onApplicationBootstrap() {
                events.push('losing:bootstrap');
              },
              onApplicationShutdown(signal?: string) {
                events.push(`losing:shutdown:${signal ?? 'none'}`);
              },
              onModuleDestroy() {
                events.push('losing:destroy');
              },
              onModuleInit() {
                events.push('losing:init');
              },
            },
          },
          {
            provide: LIFECYCLE_VALUE,
            useValue: { marker: 'winning-without-hooks' },
          },
        ],
      });

      expect(events).toEqual([]);

      await context.close('SIGTERM');

      expect(events).toEqual([]);
    },
  );

  it('does not collect bootstrap timing diagnostics by default', async () => {
    class AppModule {}
    defineModuleMetadata(AppModule, {});

    const context = await FluoFactory.createApplicationContext(AppModule);

    expect(context.bootstrapTiming).toBeUndefined();

    await context.close();
  });

  it('collects bootstrap timing diagnostics when enabled', async () => {
    class AppModule {}
    defineModuleMetadata(AppModule, {});

    const context = await FluoFactory.createApplicationContext(AppModule, {
      diagnostics: {
        timing: true,
      },
    });

    expect(context.bootstrapTiming?.version).toBe(1);
    expect(context.bootstrapTiming?.totalMs ?? 0).toBeGreaterThanOrEqual(0);
    expect(context.bootstrapTiming?.phases.some((phase) => phase.name === 'bootstrap_module')).toBe(true);

    await context.close();
  });

  it('surfaces shutdown hook failures from application context close()', async () => {
    class AppService {
      onApplicationShutdown() {
        throw new Error('context shutdown failed');
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [AppService],
    });

    const context = await FluoFactory.createApplicationContext(AppModule, {
    });

    await expect(context.close('SIGTERM')).rejects.toThrow('context shutdown failed');
  });
});

describe('runtime platform shell enforcement', () => {
  function createComponent(
    id: string,
    events: string[],
    readinessStatus: 'ready' | 'not-ready' | 'degraded' = 'ready',
    critical = true,
  ): PlatformComponent {
    let currentState: PlatformState = 'created';

    return {
      async health() {
        return { status: 'healthy' };
      },
      id,
      kind: 'test',
      async ready() {
        return {
          critical,
          reason: readinessStatus === 'ready' ? undefined : `${id} not ready`,
          status: readinessStatus,
        };
      },
      snapshot() {
        return {
          dependencies: [],
          details: {},
          health: { status: 'healthy' },
          id,
          kind: 'test',
          ownership: {
            externallyManaged: false,
            ownsResources: true,
          },
          readiness: {
            critical,
            status: readinessStatus,
          },
          state: currentState,
          telemetry: {
            namespace: 'fluo.test',
            tags: {},
          },
        };
      },
      async start() {
        currentState = 'ready';
        events.push(`start:${id}`);
      },
      state() {
        return currentState;
      },
      async stop() {
        currentState = 'stopped';
        events.push(`stop:${id}`);
      },
      async validate() {
        events.push(`validate:${id}`);
        return {
          issues: [],
          ok: true,
        };
      },
    };
  }

  it('starts registered platform components during bootstrap and stops them on close', async () => {
    const events: string[] = [];
    const redis = createComponent('redis.default', events);
    const queue = createComponent('queue.default', events);

    class AppModule {}
    defineModuleMetadata(AppModule, {});

    const app = await FluoFactory.create(AppModule, {
      platform: {
        components: [
          { component: queue, dependencies: ['redis.default'] },
          { component: redis, dependencies: [] },
        ],
      },
    });

    await app.close();

    expect(events).toEqual([
      'validate:queue.default',
      'validate:redis.default',
      'start:redis.default',
      'start:queue.default',
      'stop:queue.default',
      'stop:redis.default',
    ]);
  });

  it('fails bootstrap when a platform component registration contains unknown dependency ids', async () => {
    const events: string[] = [];
    const queue = createComponent('queue.default', events);

    class AppModule {}
    defineModuleMetadata(AppModule, {});

    await expect(
      FluoFactory.create(AppModule, {
        platform: {
          components: [{ component: queue, dependencies: ['redis.default'] }],
        },
      }),
    ).rejects.toThrow('depends on unknown component "redis.default"');
  });

  it('prevents listen() when critical platform readiness is not ready', async () => {
    const events: string[] = [];
    const unavailable = createComponent('redis.default', events, 'not-ready', true);
    const adapter = {
      async close() {},
      async listen() {},
    };

    class AppModule {}
    defineModuleMetadata(AppModule, {});

    const app = await FluoFactory.create(AppModule, {
      adapter,
      platform: {
        components: [{ component: unavailable, dependencies: [] }],
      },
    });

    await expect(app.listen()).rejects.toThrow('Runtime platform shell is not ready');
    await app.close();
  });
});

describe('FluoFactory.createMicroservice', () => {
  it('resolves microservice runtime token and starts listen()', async () => {
    const events: string[] = [];
    const MICROSERVICE_TOKEN = Symbol.for('fluo.microservices.service');

    class StubMicroserviceRuntime implements MicroserviceRuntime {
      async listen(): Promise<void> {
        events.push('listen');
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: MICROSERVICE_TOKEN,
          useClass: StubMicroserviceRuntime,
        },
      ],
    });

    const microservice = await FluoFactory.createMicroservice(AppModule, {
    });

    await microservice.listen();
    expect(events).toEqual(['listen']);

    await microservice.close();
  });

  it('throws if resolved token does not implement listen()', async () => {
    const MICROSERVICE_TOKEN = Symbol.for('fluo.microservices.service');

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: MICROSERVICE_TOKEN,
          useValue: {
            noop: true,
          },
        },
      ],
    });

    await expect(FluoFactory.createMicroservice(AppModule)).rejects.toThrow(
      'Resolved microservice token does not implement listen().',
    );
  });

  it('supports hybrid composition with FluoFactory.create()', async () => {
    const events: string[] = [];
    const MICROSERVICE_TOKEN = Symbol.for('fluo.microservices.service');

    class StubMicroserviceRuntime implements MicroserviceRuntime {
      async listen(): Promise<void> {
        events.push('micro:listen');
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: MICROSERVICE_TOKEN,
          useClass: StubMicroserviceRuntime,
        },
      ],
    });

    const app = await FluoFactory.create(AppModule, {
      adapter: {
        async close() {},
        async listen() {},
      },
    });
    const microservice = await app.container.resolve<MicroserviceRuntime>(MICROSERVICE_TOKEN);

    await Promise.all([app.listen(), microservice.listen()]);

    expect(events).toEqual(['micro:listen']);

    await app.close();
  });

  it('provides connectMicroservice() and startAllMicroservices() on the application shell', async () => {
    const events: string[] = [];
    const MICROSERVICE_TOKEN = Symbol.for('fluo.microservices.service');

    class StubMicroserviceRuntime implements MicroserviceRuntime {
      async listen(): Promise<void> {
        events.push('micro:listen');
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [
        {
          provide: MICROSERVICE_TOKEN,
          useClass: StubMicroserviceRuntime,
        },
      ],
    });

    const app = await FluoFactory.create(AppModule);
    const microservice = await app.connectMicroservice();

    await app.startAllMicroservices();

    expect(microservice.state).toBe('ready');
    expect(events).toEqual(['micro:listen']);

    await app.close();
  });
});

describe('Recovery-oriented error context (runtime)', () => {
  describe('ModuleVisibilityError includes structured context', () => {
    it('includes module name, token, and actionable hint for provider visibility failures', () => {
      class InternalRepository {}

      class DataModule {}
      defineModuleMetadata(DataModule, {
        providers: [InternalRepository],
      });

      @Inject(InternalRepository)
      class BillingService {}

      class BillingModule {}
      defineModuleMetadata(BillingModule, {
        imports: [DataModule],
        providers: [BillingService],
      });

      try {
        bootstrapModule(BillingModule);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModuleVisibilityError);
        const message = (error as Error).message;
        expect(message).toContain('Module: BillingModule');
        expect(message).toContain('Token:');
        expect(message).toContain('Phase: provider visibility validation');
        expect(message).toContain('Hint:');
        expect(message).toContain('exports');
      }
    });

    it('includes module name, token, and hint for controller visibility failures', () => {
      class InternalRepository {}

      class DataModule {}
      defineModuleMetadata(DataModule, {
        providers: [InternalRepository],
      });

      @Inject(InternalRepository)
      class BillingController {}

      class BillingModule {}
      defineModuleMetadata(BillingModule, {
        imports: [DataModule],
        controllers: [BillingController],
      });

      try {
        bootstrapModule(BillingModule);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModuleVisibilityError);
        const message = (error as Error).message;
        expect(message).toContain('Module: BillingModule');
        expect(message).toContain('Token:');
        expect(message).toContain('Phase: controller visibility validation');
        expect(message).toContain('Hint:');
      }
    });

    it('provides machine-readable meta on ModuleVisibilityError', () => {
      class InternalRepository {}

      class DataModule {}
      defineModuleMetadata(DataModule, {
        providers: [InternalRepository],
      });

      @Inject(InternalRepository)
      class BillingService {}

      class BillingModule {}
      defineModuleMetadata(BillingModule, {
        imports: [DataModule],
        providers: [BillingService],
      });

      try {
        bootstrapModule(BillingModule);
        expect.unreachable('should have thrown');
      } catch (error) {
        const meta = (error as ModuleVisibilityError & { meta?: Record<string, unknown> }).meta;
        expect(meta).toBeDefined();
        expect(meta!.module).toBe('BillingModule');
        expect(meta!.phase).toBe('provider visibility validation');
        expect(meta!.hint).toBeDefined();
        expect(meta!.token).toBeDefined();
      }
    });
  });

  describe('ModuleGraphError includes structured context', () => {
    it('includes module name and hint for circular module imports', () => {
      class ModuleA {}
      class ModuleB {}
      defineModuleMetadata(ModuleA, {
        imports: [ModuleB],
      });
      defineModuleMetadata(ModuleB, {
        imports: [ModuleA],
      });

      try {
        bootstrapModule(ModuleA);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModuleGraphError);
        const message = (error as Error).message;
        expect(message).toContain('Circular module import');
        expect(message).toContain('Module:');
        expect(message).toContain('Phase: module graph compilation');
        expect(message).toContain('Hint:');
        expect(message).toContain('extract');
      }
    });

    it('provides machine-readable meta on ModuleGraphError', () => {
      class ModuleA {}
      class ModuleB {}
      defineModuleMetadata(ModuleA, {
        imports: [ModuleB],
      });
      defineModuleMetadata(ModuleB, {
        imports: [ModuleA],
      });

      try {
        bootstrapModule(ModuleA);
        expect.unreachable('should have thrown');
      } catch (error) {
        const meta = (error as ModuleGraphError & { meta?: Record<string, unknown> }).meta;
        expect(meta).toBeDefined();
        expect(meta!.phase).toBe('module graph compilation');
        expect(meta!.hint).toBeDefined();
      }
    });
  });

  describe('ModuleInjectionMetadataError includes structured context', () => {
    it('includes module scope and hint about @Inject for missing injection metadata', () => {
      class Logger {}

      class BillingService {
        constructor(readonly logger: Logger) {}
      }

      class BillingModule {}
      defineModuleMetadata(BillingModule, {
        providers: [Logger, BillingService],
      });

      try {
        bootstrapModule(BillingModule);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModuleInjectionMetadataError);
        const message = (error as Error).message;
        expect(message).toContain('module BillingModule');
        expect(message).toContain('Phase: injection metadata validation');
        expect(message).toContain('Hint:');
        expect(message).toContain('@Inject');
      }
    });

    it('provides machine-readable meta on ModuleInjectionMetadataError', () => {
      class Logger {}

      class BillingService {
        constructor(readonly logger: Logger) {}
      }

      class BillingModule {}
      defineModuleMetadata(BillingModule, {
        providers: [Logger, BillingService],
      });

      try {
        bootstrapModule(BillingModule);
        expect.unreachable('should have thrown');
      } catch (error) {
        const meta = (error as ModuleInjectionMetadataError & { meta?: Record<string, unknown> }).meta;
        expect(meta).toBeDefined();
        expect(meta!.module).toContain('BillingModule');
        expect(meta!.phase).toBe('injection metadata validation');
        expect(meta!.hint).toBeDefined();
      }
    });
  });

  describe('DuplicateProviderError includes structured context', () => {
    it('includes module, token, and hint when policy is "throw"', () => {
      class SharedService {}

      class ModuleA {}
      defineModuleMetadata(ModuleA, {
        providers: [SharedService],
        exports: [SharedService],
      });

      class ModuleB {}
      defineModuleMetadata(ModuleB, {
        providers: [SharedService],
        exports: [SharedService],
      });

      class RootModule {}
      defineModuleMetadata(RootModule, {
        imports: [ModuleA, ModuleB],
      });

      try {
        bootstrapModule(RootModule, { duplicateProviderPolicy: 'throw' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateProviderError);
        const message = (error as Error).message;
        expect(message).toContain('SharedService');
        expect(message).toContain('Module:');
        expect(message).toContain('Token:');
        expect(message).toContain('Phase: provider registration');
        expect(message).toContain('Hint:');
      }
    });

    it('provides machine-readable meta on DuplicateProviderError', () => {
      class SharedService {}

      class ModuleA {}
      defineModuleMetadata(ModuleA, {
        providers: [SharedService],
        exports: [SharedService],
      });

      class ModuleB {}
      defineModuleMetadata(ModuleB, {
        providers: [SharedService],
        exports: [SharedService],
      });

      class RootModule {}
      defineModuleMetadata(RootModule, {
        imports: [ModuleA, ModuleB],
      });

      try {
        bootstrapModule(RootModule, { duplicateProviderPolicy: 'throw' });
        expect.unreachable('should have thrown');
      } catch (error) {
        const meta = (error as DuplicateProviderError & { meta?: Record<string, unknown> }).meta;
        expect(meta).toBeDefined();
        expect(meta!.module).toBeDefined();
        expect(meta!.token).toBeDefined();
        expect(meta!.phase).toBe('provider registration');
        expect(meta!.hint).toBeDefined();
      }
    });
  });

  describe('ModuleVisibilityError for export validation includes context', () => {
    it('includes module name, token, and hint when exporting a non-local token', () => {
      class NonExistentService {}

      class BadModule {}
      defineModuleMetadata(BadModule, {
        exports: [NonExistentService],
      });

      class AppModule {}
      defineModuleMetadata(AppModule, {
        imports: [BadModule],
      });

      try {
        bootstrapModule(AppModule);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModuleVisibilityError);
        const message = (error as Error).message;
        expect(message).toContain('BadModule');
        expect(message).toContain('Phase: export validation');
        expect(message).toContain('Hint:');
        expect(message).toContain('providers');
      }
    });
  });
});
