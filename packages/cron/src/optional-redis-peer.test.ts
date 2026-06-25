import { afterEach, describe, expect, it, vi } from 'vitest';

const OPTIONAL_PEER_IMPORT_TIMEOUT_MS = 15_000;

afterEach(() => {
  vi.doUnmock('@fluojs/redis');
  vi.resetModules();
});

function createMissingRedisPeerError(): Error {
  return Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  });
}

describe('optional Redis peer contract', () => {
  it('keeps the root barrel importable when Redis peers are absent', async () => {
    vi.doMock('@fluojs/redis', () => {
      throw createMissingRedisPeerError();
    });

    const cronPublicApi = await import('./index.js');

    expect(cronPublicApi).toHaveProperty('CronModule');
    expect(cronPublicApi).toHaveProperty('Cron');
    expect(cronPublicApi).toHaveProperty('SCHEDULING_REGISTRY');
  }, OPTIONAL_PEER_IMPORT_TIMEOUT_MS);

  it('does not load Redis while bootstrapping non-distributed scheduling', async () => {
    vi.doMock('@fluojs/redis', () => {
      throw createMissingRedisPeerError();
    });

    const [{ bootstrapApplication, defineModule }, { CronModule }] = await Promise.all([
      import('@fluojs/runtime'),
      import('./module.js'),
    ]);

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ distributed: { enabled: false } })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await app.close();
  });

  it('loads Redis only when distributed scheduling is enabled', async () => {
    const redisTokenRequests: string[] = [];

    vi.doMock('@fluojs/redis', () => {
      return {
        getRedisClientToken: (clientName?: string) => {
          redisTokenRequests.push(clientName ?? 'default');
          return Symbol('mock.redis.client');
        },
      };
    });

    const [{ bootstrapApplication, defineModule }, { CronModule }] = await Promise.all([
      import('@fluojs/runtime'),
      import('./module.js'),
    ]);

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ distributed: { enabled: true } })],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Cron distributed mode requires the configured Redis client to be registered.',
    );
    expect(redisTokenRequests).toEqual(['default']);
  });
});
