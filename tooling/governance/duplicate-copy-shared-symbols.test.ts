import { expect, it } from 'vitest';

const moduleUrls = {
  config: new URL('../../packages/config/src/module.ts', import.meta.url),
  http: new URL('../../packages/http/src/dispatch/fast-path/eligibility.ts', import.meta.url),
  queue: new URL('../../packages/queue/src/tokens.ts', import.meta.url),
  redisTokens: new URL('../../packages/redis/src/tokens.ts', import.meta.url),
  runtime: new URL('../../packages/runtime/src/tokens.ts', import.meta.url),
};

it.each(Object.entries(moduleUrls))(
  'keeps framework-owned symbols interoperable across duplicate %s modules',
  async (_name, moduleUrl) => {
    const first = await import(`${moduleUrl.href}?governance-copy=first`);
    const second = await import(`${moduleUrl.href}?governance-copy=second`);
    const firstSymbols = Object.entries(first)
      .filter((entry): entry is [string, symbol] => typeof entry[1] === 'symbol')
      .map(([name, value]) => [name, value] as const);

    expect(firstSymbols.length).toBeGreaterThan(0);
    for (const [name, symbol] of firstSymbols) {
      expect(second[name], `${name} must be shared`).toBe(symbol);
    }
  },
);

it('keeps named Redis helper tokens interoperable across duplicate modules', async () => {
  const moduleUrl = new URL('../../packages/redis/src/redis-service.ts', import.meta.url);
  const first = await import(`${moduleUrl.href}?governance-copy=first`);
  const second = await import(`${moduleUrl.href}?governance-copy=second`);

  expect(first.getRedisServiceToken(' cache ')).toBe(second.getRedisServiceToken('cache'));
  expect(first.RedisService).not.toBe(second.RedisService);
});
