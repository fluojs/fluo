import { expect, it } from 'vitest';

const moduleUrl = new URL('./module.ts', import.meta.url);

it('shares the public config reloader token across compatible module copies', async () => {
  const first = await import(`${moduleUrl.href}?module-copy=first`);
  const second = await import(`${moduleUrl.href}?module-copy=second`);

  expect(first.CONFIG_RELOADER).toBe(second.CONFIG_RELOADER);
});
