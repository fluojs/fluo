import { expect, test, type Page } from '@playwright/test';

const media = 'application/vnd.fluo.react-navigation+json;v=2';

async function connected(page: Page) {
  await page.locator('form[data-enhanced]').first().evaluate((form) => {
    if (form.getAttribute('data-enhanced') === 'true') return;
    return new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (form.getAttribute('data-enhanced') !== 'true') return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Provider did not connect')); }, 10_000);
      observer.observe(form, { attributes: true });
    });
  });
}

async function protectedEdit(page: Page, form: string, value: string) {
  await page.getByRole('complementary', { name: 'Navigation protection' }).evaluate((owner) => {
    Reflect.set(window, '__guardProtection', owner.getAttribute('data-protected') === 'true'
      ? Promise.resolve() : new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          if (owner.getAttribute('data-protected') !== 'true') return;
          observer.disconnect(); clearTimeout(timeout); resolve();
        });
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Dirty protection did not commit')); }, 10_000);
        observer.observe(owner, { attributes: true, attributeFilter: ['data-protected'] });
      }));
  });
  await page.getByRole('form', { name: form, exact: true }).getByRole('textbox').fill(value);
  await page.evaluate(() => Reflect.get(window, '__guardProtection'));
}

async function editor(page: Page) {
  await page.goto('/catalog/login');
  await connected(page);
  await page.getByRole('link', { name: 'Read sku-42', exact: true }).click();
  await connected(page);
  await page.getByRole('checkbox', { name: 'Protect edits' }).check();
  await protectedEdit(page, 'Save product', 'Protected draft');
}

async function probe(page: Page) {
  await page.evaluate(() => {
    const output = document.querySelector('[aria-label="Resource acknowledgement"]');
    if (output === null) throw new Error('Missing actual resource acknowledgement');
    const previous = output.textContent;
    Reflect.set(window, '__guardAck', new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (output.textContent === previous) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Resource did not acknowledge')); }, 10_000);
      observer.observe(output, { subtree: true, childList: true, characterData: true });
    }));
  });
  await page.getByRole('button', { name: 'Probe shell resource', exact: true }).click();
  await page.evaluate(() => Reflect.get(window, '__guardAck'));
}

test('stay and proceed preserve the actual editing DOM, head and operational shell before HTTP permission', async ({ page }, info) => {
  const errors: string[] = [];
  const reads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await editor(page);
  await page.evaluate(() => {
    Reflect.set(window, '__guardDocument', document);
    Reflect.set(window, '__guardInput', document.querySelector('form[aria-label="Save product"] input[name="display_name"]'));
    Reflect.set(window, '__guardResource', window.__reactResource);
  });
  const title = await page.title();
  const historyLength = await page.evaluate(() => history.length);
  await probe(page);
  page.on('request', (request) => { if (request.headers().accept === media) reads.push(request.url()); });
  await page.getByRole('link', { name: 'Product list', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved navigation' })).toBeVisible();
  expect(reads).toEqual([]);
  expect(await page.title()).toBe(title);
  await expect(page.getByRole('heading', { name: 'Product sku-42' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('guard-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('guard-mobile.png') });
  await page.getByRole('button', { name: 'Stay here' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(reads).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, '__guardInput') === document.querySelector('form[aria-label="Save product"] input[name="display_name"]'))).toBe(true);
  await expect(page.getByRole('form', { name: 'Save product', exact: true }).getByRole('textbox')).toHaveValue('Protected draft');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await probe(page);
  await page.getByRole('link', { name: 'Product list', exact: true }).click();
  const approved = page.waitForResponse((response) => new URL(response.url()).pathname === '/catalog'
    && response.request().headers().accept === media);
  await page.getByRole('button', { name: 'Proceed with navigation' }).click();
  expect((await approved).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Catalog', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__guardDocument') === document)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, '__guardResource') === window.__reactResource)).toBe(true);
  await probe(page);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ observation: 'guard-permission', reads: reads.length, documentRetained: true, actualResourceAck: true }));
});

test('real backward and forward cancellation restore managed entry order without destination reads', async ({ page }) => {
  await editor(page);
  const length = await page.evaluate(() => history.length);
  const reads: string[] = [];
  page.on('request', (request) => { if (request.headers().accept === media) reads.push(request.url()); });
  await page.evaluate(() => history.back());
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog\/sku-42$/u);
  await page.getByRole('button', { name: 'Stay here' }).click();
  expect(reads).toEqual([]);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.evaluate(() => history.back());
  const back = page.waitForResponse((response) => response.request().headers().accept === media
    && new URL(response.url()).pathname === '/catalog');
  await page.getByRole('button', { name: 'Proceed with navigation' }).click();
  expect((await back).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Catalog', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Protect edits' }).check();
  await protectedEdit(page, 'Independent product', 'Forward draft');
  await page.evaluate(() => history.forward());
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog$/u);
  await page.getByRole('button', { name: 'Stay here' }).click();
  expect(reads).toHaveLength(1);
  await page.evaluate(() => history.forward());
  const forward = page.waitForResponse((response) => response.request().headers().accept === media
    && new URL(response.url()).pathname === '/catalog/sku-42');
  await page.getByRole('button', { name: 'Proceed with navigation' }).click();
  expect((await forward).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Product sku-42' })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length);
  expect(reads).toHaveLength(2);
});

test('two actual POST acknowledgements settle out of order without overriding dirty navigation intent', async ({ page }) => {
  await editor(page);
  let releaseFirst = () => {};
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstArrived = () => {};
  const firstStarted = new Promise<void>((resolve) => { firstArrived = resolve; });
  await page.route('**/catalog/sku-42/update', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    firstArrived();
    await firstRelease;
    await route.fulfill({ response: actual });
  });
  try {
    const form = page.getByRole('form', { name: 'Save product', exact: true });
    await form.getByRole('button', { name: 'Save product', exact: true }).click();
    await firstStarted;
    await form.getByRole('textbox').fill('Newer draft after persistence');
    const independent = page.getByRole('form', { name: 'Independent product', exact: true });
    await independent.getByRole('textbox').fill('Out of order created product');
    const second = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/catalog/create');
    await independent.getByRole('button', { name: 'Independent product', exact: true }).click();
    expect((await second).status()).toBe(200);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Stay here' }).click();
    await expect(page.locator('[data-form-state="independent-product"]')).toContainText('saved read:cancelled');
    const first = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/catalog/sku-42/update');
    releaseFirst();
    expect((await first).status()).toBe(200);
    await expect(page.locator('[data-form-state="edit-sku-42"]')).toContainText('saved read:complete');
    await expect(form.getByRole('textbox')).toHaveValue('Newer draft after persistence');
    await page.locator('section[aria-label="Catalog CRUD"]').getByRole('link', { name: 'Search catalog', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const search = page.waitForResponse((response) => new URL(response.url()).pathname === '/catalog/search'
      && response.request().headers().accept === media);
    await page.getByRole('button', { name: 'Proceed with navigation' }).click();
    const result = await search;
    expect(result.status()).toBe(200);
    const payload = await result.json();
    expect(payload.destination.props.searchQuery).toBe('draft');
    expect(payload.destination.props.products).toContainEqual({ sku: 'sku-42', name: 'Protected draft' });
    await expect(page).toHaveURL(/\/catalog\/search\?q=draft$/u);
    await probe(page);
    console.log(JSON.stringify({ observation: 'two-post-guard-race', posts: 2, actualPersistenceBeforeHeldAck: true, newerDraftRetained: true, search: 200 }));
  } finally {
    releaseFirst();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('an open dirty decision cannot postpone explicit logout or actual resource cleanup', async ({ page }) => {
  await page.goto('/catalog/session');
  await connected(page);
  const signedIn = page.waitForResponse((response) => new URL(response.url()).pathname === '/catalog/session/protected'
    && response.request().headers().accept === media);
  await page.getByRole('button', { name: 'Login A', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.getByRole('textbox', { name: 'Protected draft' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Protect edits' }).check();
  await page.getByRole('textbox', { name: 'Protected draft' }).fill('Revoked private input');
  await probe(page);
  const cleanupsBefore = await page.evaluate(() => window.__reactResourceStats?.cleanups ?? 0);
  await page.getByRole('link', { name: 'Session soft page', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(window, '__guardCleanup', new Promise<void>((resolve, reject) => {
      const onCleanup = (event: Event) => {
        if (!(event instanceof CustomEvent) || event.detail?.phase !== 'cleanup') return;
        document.removeEventListener('fluo-resource', onCleanup); clearTimeout(timeout); resolve();
      };
      const timeout = setTimeout(() => { document.removeEventListener('fluo-resource', onCleanup); reject(new Error('No resource cleanup')); }, 10_000);
      document.addEventListener('fluo-resource', onCleanup);
    }));
  });
  await page.getByRole('button', { name: 'Notify logout', exact: true }).click();
  await page.evaluate(() => Reflect.get(window, '__guardCleanup'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Protected draft' })).toHaveCount(0);
  await expect(page.locator('[data-session-state]')).toContainText('signed-out');
  expect(await page.title()).not.toBe('Protected a');
  expect(await page.evaluate(() => window.__reactResourceStats?.cleanups)).toBe(cleanupsBefore + 1);
  console.log(JSON.stringify({ observation: 'guard-auth-priority', protectedInputRemoved: true, resourceCleaned: true }));
});
