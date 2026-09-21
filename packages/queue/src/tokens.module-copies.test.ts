import { expect, it } from 'vitest';

const tokensModuleUrl = new URL('./tokens.ts', import.meta.url);

it('shares default, normalized scoped, and registration marker tokens across compatible module copies', async () => {
  const first = await import(`${tokensModuleUrl.href}?module-copy=first`);
  const second = await import(`${tokensModuleUrl.href}?module-copy=second`);

  expect({
    contextMarker: first.QUEUE_MODULE_CONTEXT_MARKER === second.QUEUE_MODULE_CONTEXT_MARKER,
    defaultContext: first.getQueueModuleContextToken() === second.getQueueModuleContextToken(),
    defaultLifecycle: first.getQueueLifecycleServiceToken() === second.getQueueLifecycleServiceToken(),
    defaultOptions: first.getQueueOptionsToken() === second.getQueueOptionsToken(),
    defaultQueue: first.getQueueToken() === second.getQueueToken(),
    defaultRedis: first.getQueueRedisClientToken() === second.getQueueRedisClientToken(),
    scopedContext: first.getQueueModuleContextToken(' jobs ') === second.getQueueModuleContextToken('jobs'),
    scopedLifecycle: first.getQueueLifecycleServiceToken(' jobs ') === second.getQueueLifecycleServiceToken('jobs'),
    scopedOptions: first.getQueueOptionsToken(' jobs ') === second.getQueueOptionsToken('jobs'),
    scopedQueue: first.getQueueToken(' jobs ') === second.getQueueToken('jobs'),
    scopedRedis: first.getQueueRedisClientToken(' jobs ') === second.getQueueRedisClientToken('jobs'),
  }).toEqual({
    contextMarker: true,
    defaultContext: true,
    defaultLifecycle: true,
    defaultOptions: true,
    defaultQueue: true,
    defaultRedis: true,
    scopedContext: true,
    scopedLifecycle: true,
    scopedOptions: true,
    scopedQueue: true,
    scopedRedis: true,
  });
});
