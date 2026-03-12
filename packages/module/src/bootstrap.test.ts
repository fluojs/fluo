import { describe, expect, it } from 'vitest';

import { Global, Inject, Module, defineModuleMetadata } from '@konekti/core';

import { bootstrapModule } from './bootstrap';

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
