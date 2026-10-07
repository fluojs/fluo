import { expect, test, type Page, type TestInfo } from '@playwright/test';

const products = '/catalog/session/products';
const navigationType = 'application/vnd.fluo.react-navigation+json;v=2';

async function capture(page: Page, info: TestInfo, surface: string) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const name = `${surface}-${viewport.width}-${colorScheme}`;
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
}

async function connected(page: Page) {
  await page.locator('form[data-enhanced]').first().evaluate((form) => {
    if (form.getAttribute('data-enhanced') === 'true') return;
    return new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (form.getAttribute('data-enhanced') !== 'true') return;
        observer.disconnect(); clearTimeout(deadline); resolve();
      });
      const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('Hydration did not connect forms')); }, 10_000);
      observer.observe(form, { attributes: true, attributeFilter: ['data-enhanced'] });
    });
  });
}

async function login(page: Page, identity: 'a' | 'b') {
  const post = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/session/login');
  const read = page.waitForResponse((response) => response.request().headers().accept === navigationType
    && new URL(response.url()).pathname === '/catalog/session/protected');
  await page.getByRole('button', { name: `Login ${identity.toUpperCase()}`, exact: true }).click();
  expect((await post).status()).toBe(200);
  expect((await read).status()).toBe(200);
  await expect(page.locator(`[data-product="private-${identity}"]`)).toBeVisible();
  const approved = page.waitForResponse((response) => new URL(response.url()).pathname === products
    && response.request().headers().accept === navigationType);
  await page.getByRole('link', { name: 'Authenticated products', exact: true }).click();
  expect((await approved).status()).toBe(200);
  await expect(page.getByRole('region', { name: 'Authenticated catalog CRUD' })).toBeVisible();
}

test('authenticated product: enhanced invalid/correct/save/logout/relogin -> confirmed persistence and revocation', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/catalog/session');
  await connected(page);
  await capture(page, info, 'sign-in');
  await login(page, 'a');
  await capture(page, info, 'authenticated-list');
  const create = page.getByRole('form', { name: 'Create product', exact: true });
  await create.getByRole('textbox').fill('Integrated private product');
  const created = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${products}/create`);
  await create.getByRole('button', { name: 'Create product', exact: true }).click();
  expect((await created).status()).toBe(200);
  await expect(page).toHaveURL(/\/catalog\/session\/products\/item-\d+$/u);
  const sku = new URL(page.url()).pathname.split('/').at(-1);
  if (sku === undefined) throw new Error('Missing product identity');
  const edit = page.getByRole('form', { name: 'Save product', exact: true });
  await edit.getByRole('textbox').fill('x');
  await edit.evaluate((form) => { if (form instanceof HTMLFormElement) form.noValidate = true; });
  const invalid = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${products}/${sku}/update`);
  await edit.getByRole('button', { name: 'Save product', exact: true }).click();
  expect((await invalid).status()).toBe(400);
  await expect(edit.getByRole('textbox')).toHaveValue('x');
  await expect(edit.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  await expect(edit.getByRole('textbox')).toBeFocused();
  await capture(page, info, 'authenticated-invalid-edit');
  await edit.getByRole('textbox').fill('Corrected integrated product');
  const saved = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${products}/${sku}/update`);
  const fresh = page.waitForResponse((response) => response.request().headers().accept === navigationType
    && new URL(response.url()).pathname === `${products}/${sku}`);
  await edit.getByRole('button', { name: 'Save product', exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect((await fresh).status()).toBe(200);
  await expect(page.locator(`[data-product="${sku}"]`)).toHaveText('Corrected integrated product');
  const logout = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/session/logout');
  await page.getByRole('button', { name: 'Logout HTTP', exact: true }).click();
  expect((await logout).status()).toBe(200);
  await expect(page.locator(`[data-product="${sku}"]`)).toHaveCount(0);
  expect((await page.request.get(`${products}/${sku}`)).status()).toBe(401);
  await login(page, 'b');
  await expect(page.locator(`[data-product="${sku}"]`)).toHaveText('Corrected integrated product');
  const search = page.getByRole('form', { name: 'Product search', exact: true });
  await search.getByRole('textbox').fill('Corrected integrated');
  const searched = page.waitForResponse((response) => response.request().method() === 'GET'
    && new URL(response.url()).pathname === products
    && new URL(response.url()).searchParams.get('q') === 'Corrected integrated');
  await search.getByRole('button', { name: 'Search products', exact: true }).click();
  expect((await searched).status()).toBe(200);
  await expect(page.locator('[data-product]')).toHaveCount(1);
  await connected(page);
  const detail = page.waitForResponse((response) => new URL(response.url()).pathname === `${products}/${sku}`
    && response.request().headers().accept === navigationType);
  await page.getByRole('link', { name: `Read ${sku}`, exact: true }).click();
  expect((await detail).status()).toBe(200);
  const removed = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `${products}/${sku}/delete`);
  await page.getByRole('button', { name: 'Delete product', exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(page).toHaveURL(products);
  expect((await page.request.get(`${products}/${sku}`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

for (const mode of ['js-disabled', 'bootstrap-blocked'] as const) {
  test(`authenticated product: ${mode} -> native POST303GET validation CRUD and relogin`, async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: mode !== 'js-disabled' });
    try {
      const page = await context.newPage();
      if (mode === 'bootstrap-blocked') {
        await page.route((url) => url.pathname.endsWith('.js') || url.pathname.endsWith('.tsx')
          || url.pathname.startsWith('/@'), (route) => route.abort());
      }
      await page.goto('/catalog/session');
      const loggedIn = page.waitForResponse((response) => response.status() === 303
        && new URL(response.url()).pathname === '/catalog/session/login');
      await page.getByRole('button', { name: 'Login A', exact: true }).click();
      await loggedIn;
      await page.getByRole('link', { name: 'Authenticated products', exact: true }).click();
      const form = page.getByRole('form', { name: 'Create product', exact: true });
      const name = `Native ${mode} product`;
      await form.getByRole('textbox').fill(name);
      const created = page.waitForResponse((response) => response.status() === 303
        && new URL(response.url()).pathname === `${products}/create`);
      await form.getByRole('button', { name: 'Create product', exact: true }).click();
      await created;
      const sku = new URL(page.url()).pathname.split('/').at(-1);
      if (sku === undefined) throw new Error('Missing native product identity');
      await expect(page.locator(`[data-product="${sku}"]`)).toHaveText(name);
      const edit = page.getByRole('form', { name: 'Save product', exact: true });
      await edit.getByRole('textbox').fill('x');
      await edit.evaluate((form) => { if (form instanceof HTMLFormElement) form.noValidate = true; });
      const invalid = page.waitForResponse((response) => response.status() === 400
        && new URL(response.url()).pathname === `${products}/${sku}/update`);
      await edit.getByRole('button', { name: 'Save product', exact: true }).click();
      await invalid;
      await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('x');
      await expect(page.getByRole('heading')).toHaveCount(1);
      await capture(page, info, `native-error-${mode}`);
      await page.getByLabel('Product name', { exact: true }).fill(`${name} corrected`);
      const saved = page.waitForResponse((response) => response.status() === 303
        && new URL(response.url()).pathname === `${products}/${sku}/update`);
      await page.getByRole('button', { name: 'Save product', exact: true }).click();
      await saved;
      await expect(page.locator(`[data-product="${sku}"]`)).toHaveText(`${name} corrected`);
      await page.getByRole('button', { name: 'Logout HTTP', exact: true }).click();
      await expect(page).toHaveURL(/\/catalog\/session$/u);
      expect((await page.request.get(`${products}/${sku}`)).status()).toBe(401);
      await page.getByRole('button', { name: 'Login B', exact: true }).click();
      await page.getByRole('link', { name: 'Authenticated products', exact: true }).click();
      const search = page.getByRole('form', { name: 'Product search', exact: true });
      await search.getByRole('textbox').fill(name);
      const searched = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname === products
        && new URL(response.url()).searchParams.get('q') === name);
      await search.getByRole('button', { name: 'Search products', exact: true }).click();
      expect((await searched).status()).toBe(200);
      await expect(page.locator('[data-product]')).toHaveCount(1);
      await page.getByRole('link', { name: `Read ${sku}`, exact: true }).click();
      const removed = page.waitForResponse((response) => response.status() === 303
        && new URL(response.url()).pathname === `${products}/${sku}/delete`);
      await page.getByRole('button', { name: 'Delete product', exact: true }).click();
      await removed;
      await expect(page).toHaveURL(products);
      expect((await page.request.get(`${products}/${sku}`)).status()).toBe(404);
    } finally {
      await context.close();
    }
  });
}
