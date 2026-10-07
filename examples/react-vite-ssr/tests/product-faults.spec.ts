import { expect, test } from '@playwright/test';

const products = '/catalog/session/products';

for (const phase of ['handler', 'commit'] as const) {
  test(`authenticated product: logout during ${phase} save -> old continuation revoked without rollback claim`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/catalog/session');
    const origin = new URL(page.url()).origin;
    expect((await page.request.post('/catalog/session/login', {
      form: { identity: 'a', csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
    })).status()).toBe(303);
    await page.goto(products);
    const form = page.getByRole('form', { name: 'Create product', exact: true });
    await expect(form).toHaveAttribute('data-enhanced', 'true');
    await page.getByRole('button', { name: 'Use shell resource', exact: true }).click();
    const heldName = `Held authenticated ${phase}:${info.project.name}`;
    const key = `POST:${products}/create:${heldName}`;
    expect((await page.request.post('/__background/arm', { data: { key, phase } })).ok()).toBe(true);
    const started = page.request.get(`/__background/started?key=${encodeURIComponent(key)}`, { timeout: 10_000 });
    const cleaned = page.request.get(`/__background/cleaned?key=${encodeURIComponent(key)}`, { timeout: 10_000 });
    try {
      await form.getByRole('textbox').fill(heldName);
      await form.getByRole('button', { name: 'Create product', exact: true }).click();
      const held = await (await started).json();
      expect(held.phase).toBe(phase);
      const obsolete = page.waitForEvent('requestfailed', (request) => request.method() === 'POST'
        && new URL(request.url()).pathname === `${products}/create`);
      const logout = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/catalog/session/logout');

      await page.getByRole('button', { name: 'Logout HTTP', exact: true }).click();

      expect((await logout).status()).toBe(200);
      await obsolete;
      await expect(page.getByRole('region', { name: 'Authenticated catalog CRUD' })).toHaveCount(0);
      await expect(page.locator('[data-session-state]')).toContainText('demo:signed-out');
      expect((await page.request.get(products)).status()).toBe(401);
      expect((await page.request.post('/__background/release', { data: { keys: [key] } })).ok()).toBe(true);
      expect((await cleaned).ok()).toBe(true);
      const state = await (await page.request.get('/__forms/state')).json();
      const commits = state.events.filter((event: { phase: string; name?: string }) =>
        event.phase === 'commit' && event.name === heldName);
      expect(commits).toHaveLength(1);
      // HTTP had already authorized this dispatched write; browser cancellation is not rollback.
      expect((await page.request.post('/catalog/session/login', {
        form: { identity: 'b', csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
      })).status()).toBe(303);
      const approved = await page.request.get(`${products}?q=${encodeURIComponent(heldName)}`, {
        headers: { Accept: 'application/vnd.fluo.react-navigation+json;v=2' },
      });
      expect(approved.status()).toBe(200);
      expect((await approved.json()).destination.props.products).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await page.request.post('/__background/release', { data: { keys: [key] } });
      await Promise.allSettled([started, cleaned]);
    }
  });
}

test('authenticated product: credentialed permission refusal -> forbidden identity and fresh relogin', async ({ page }, info) => {
  await page.goto('/catalog/session');
  const origin = new URL(page.url()).origin;
  expect((await page.request.post('/catalog/session/login', {
    form: { identity: 'a', csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
  })).status()).toBe(303);
  await page.goto(products);
  await expect(page.getByRole('form', { name: 'Create product', exact: true })).toHaveAttribute('data-enhanced', 'true');
  expect((await page.request.post('/catalog/session/permissions', {
    form: { csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
  })).status()).toBe(303);
  const forbidden = page.waitForResponse((response) => response.request().headers().accept
    === 'application/vnd.fluo.react-navigation+json;v=2' && new URL(response.url()).pathname === products);

  await page.getByRole('button', { name: 'Session refresh', exact: true }).click();

  expect((await forbidden).status()).toBe(403);
  await expect(page.locator('[data-session-state]')).toContainText('forbidden');
  await expect(page.getByRole('region', { name: 'Authenticated catalog CRUD' })).toHaveCount(0);
  expect((await page.context().cookies()).find((cookie) => cookie.name === 'catalogSession')?.value).toBe('a');
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const name = `authenticated-forbidden-${viewport.width}-${colorScheme}`;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: 'image/png' });
      if (await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.screenshot({ path: info.outputPath(`${name}-end.png`) });
        await info.attach(`${name}-end`, { path: info.outputPath(`${name}-end.png`), contentType: 'image/png' });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  const login = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/session/login');
  await page.getByRole('button', { name: 'Login B', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page.locator('[data-product="private-b"]')).toHaveText('Protected content b');
});
