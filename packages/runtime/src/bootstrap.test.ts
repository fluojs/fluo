import { describe, expect, it, vi } from 'vitest';

import { Global, Inject, Module, defineModuleMetadata } from '@konekti/core';

import { bootstrapModule } from './bootstrap.js';
import { DuplicateProviderError, ModuleInjectionMetadataError } from './errors.js';

describe('bootstrapModule', () => {
  it('boots a simple module graph deterministically', () => {
    class Logger {}

    class SharedModule {}
    defineModuleMetadata(SharedModule, {
      exports: [Logger],
      providers: [Logger],
    });

    @Inject([Logger])
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

    @Inject([InternalRepository])
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

  it('allows exported providers from a global module without direct imports', () => {
    class Logger {}

    @Global()
    @Module({
      exports: [Logger],
      providers: [Logger],
    })
    class SharedModule {}

    @Inject([Logger])
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
  it('does not throw for a class decorated with @Inject([]) (explicit empty inject list)', () => {
    @Inject([])
    class ZeroDependencyService {}

    class AppModule {}
    defineModuleMetadata(AppModule, {
      providers: [ZeroDependencyService],
    });

    expect(() => bootstrapModule(AppModule)).not.toThrow();
  });

  it('does not throw for a class decorated with @Inject([Token]) that also has a default parameter', () => {
    class Logger {}

    @Inject([Logger])
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
});
