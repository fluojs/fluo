import { expect, it } from 'vitest';

const eligibilityModuleUrl = new URL('./eligibility.ts', import.meta.url);

it('shares public fast-path symbols across compatible module copies', async () => {
  const first = await import(`${eligibilityModuleUrl.href}?module-copy=first`);
  const second = await import(`${eligibilityModuleUrl.href}?module-copy=second`);

  expect(first.FAST_PATH_ELIGIBILITY_SYMBOL).toBe(second.FAST_PATH_ELIGIBILITY_SYMBOL);
  expect(first.FAST_PATH_STATS_SYMBOL).toBe(second.FAST_PATH_STATS_SYMBOL);
});
