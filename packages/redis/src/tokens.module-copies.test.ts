import { expect, it } from 'vitest';

const tokensModuleUrl = new URL('./tokens.ts', import.meta.url);
const serviceModuleUrl = new URL('./redis-service.ts', import.meta.url);

it('shares default and normalized named Redis tokens across compatible module copies', async () => {
  const firstTokens = await import(`${tokensModuleUrl.href}?module-copy=first`);
  const secondTokens = await import(`${tokensModuleUrl.href}?module-copy=second`);
  const firstService = await import(`${serviceModuleUrl.href}?module-copy=first`);
  const secondService = await import(`${serviceModuleUrl.href}?module-copy=second`);

  expect(firstTokens.REDIS_CLIENT).toBe(secondTokens.REDIS_CLIENT);
  expect(firstTokens.getRedisClientToken(' cache ')).toBe(secondTokens.getRedisClientToken('cache'));
  expect(firstService.getRedisServiceToken(' cache ')).toBe(secondService.getRedisServiceToken('cache'));

  expect(firstService.getRedisServiceToken()).toBe(firstService.RedisService);
  expect(secondService.getRedisServiceToken()).toBe(secondService.RedisService);
  expect(firstService.RedisService).not.toBe(secondService.RedisService);
});
