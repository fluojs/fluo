import { describe, expect, it } from 'vitest';

import { Inject, Module } from '@konekti/core';

import { createTestingModule } from './module';

describe('@konekti/testing', () => {
  it('creates a testing module and resolves providers from the module graph', async () => {
    class Logger {
      readonly name = 'logger';
    }

    @Inject([Logger])
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class AppModule {}

    const testingModule = await createTestingModule({
      rootModule: AppModule,
    }).compile();

    const service = await testingModule.resolve(UserService);

    expect(testingModule.has(UserService)).toBe(true);
    expect(service.logger.name).toBe('logger');
  });

  it('overrides providers before resolution', async () => {
    class Logger {
      readonly name = 'logger';
    }

    @Inject([Logger])
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class AppModule {}

    const testingModule = await createTestingModule({
      rootModule: AppModule,
    })
      .overrideProvider(Logger, { name: 'fake-logger' })
      .compile();

    const service = await testingModule.resolve(UserService);

    expect(service.logger).toEqual({ name: 'fake-logger' });
  });
});
