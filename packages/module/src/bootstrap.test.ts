import { describe, expect, it } from 'vitest';

import { defineModuleMetadata } from '@konekti/core';

import { bootstrapModule } from './bootstrap';

describe('bootstrapModule', () => {
  it('boots a simple module graph deterministically', () => {
    class Logger {}

    class SharedModule {}
    defineModuleMetadata(SharedModule, {
      exports: [Logger],
      providers: [Logger],
    });

    class AppService {
      static inject = [Logger];

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

    class BillingService {
      static inject = [InternalRepository];
    }

    class BillingModule {}
    defineModuleMetadata(BillingModule, {
      imports: [DataModule],
      providers: [BillingService],
    });

    expect(() => bootstrapModule(BillingModule)).toThrow('not local and not exported');
  });
});
