import { expect, it } from 'vitest';

const tokensModuleUrl = new URL('./tokens.ts', import.meta.url);
const serviceModuleUrl = new URL('./redis-service.ts', import.meta.url);

it('shares default and normalized named Redis tokens across compatible module copies', async () => {
  const firstTokens = await import(`${tokensModuleUrl.href}?module-copy=first`);
  const secondTokens = await import(`${tokensModuleUrl.href}?module-copy=second`);
  const firstService = await import(`${serviceModuleUrl.href}?module-copy=first`);
  const secondService = await import(`${serviceModuleUrl.href}?module-copy=second`);

  expect(firstTokens.REDIS_CLIENT).toBe(secondTokens.REDIS_CLIENT);
  expect(firstTokens.DEFAULT_REDIS_CLIENT_NAME).toBe('default');
  expect(secondTokens.DEFAULT_REDIS_CLIENT_NAME).toBe('default');
  expect(firstTokens.getRedisClientToken()).toBe(firstTokens.REDIS_CLIENT);
  expect(secondTokens.getRedisClientToken()).toBe(secondTokens.REDIS_CLIENT);
  expect(firstTokens.getRedisClientToken(' cache ')).toBe(secondTokens.getRedisClientToken('cache'));
  expect(firstService.getRedisServiceToken(' cache ')).toBe(secondService.getRedisServiceToken('cache'));
  expect(firstTokens.getRedisClientToken(' default ')).toBe(secondTokens.getRedisClientToken('default'));
  expect(firstTokens.getRedisClientToken('default')).not.toBe(firstTokens.REDIS_CLIENT);
  expect(Symbol.keyFor(firstTokens.getRedisClientToken('default'))).toBe('fluo.redis.client:default');
  expect(firstService.getRedisServiceToken(' default ')).toBe(secondService.getRedisServiceToken('default'));
  expect(firstService.getRedisServiceToken('default')).not.toBe(firstService.RedisService);
  expect(Symbol.keyFor(firstService.getRedisServiceToken('default'))).toBe('fluo.redis.service:default');

  for (const tokens of [firstTokens, secondTokens]) {
    expect(tokens.getRedisComponentId()).toBe('redis.default');
    expect(tokens.getRedisComponentId('default')).toBe('redis.default');
    expect(tokens.getRedisComponentId(' default ')).toBe('redis.default');
  }

  expect(firstService.getRedisServiceToken()).toBe(firstService.RedisService);
  expect(secondService.getRedisServiceToken()).toBe(secondService.RedisService);
  expect(firstService.RedisService).not.toBe(secondService.RedisService);
});
