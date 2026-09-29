import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __softNavigationDocument?: string;
  }
}

test('hydrates streamed production HTML with generated Vite assets', async ({ page }) => {
  const browserDiagnostics: string[] = [];
  const assetResponses = new Map<string, number>();

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    browserDiagnostics.push(`pageerror: ${error.message}`);
  });
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/assets/')) {
      assetResponses.set(pathname, response.status());
    }
  });

  const response = await page.goto('/products/sku-42?preview=true#details', { waitUntil: 'networkidle' });
  if (response === null) {
    throw new TypeError('The production page did not return a navigation response.');
  }

  const html = await response.text();
  const bootstrapPaths = await page.locator('script[type="module"][src]').evaluateAll((scripts) =>
    scripts.map((script) => new URL(script.getAttribute('src') ?? '', document.baseURI).pathname),
  );
  const stylesheetPaths = await page.locator('link[data-vite-style][href]').evaluateAll((links) =>
    links.map((link) => new URL(link.getAttribute('href') ?? '', document.baseURI).pathname),
  );

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(html).toContain('Loading recommendations');
  expect(html).toContain('Recommended for sku-42');
  expect(html).toContain('Current URL: /products/sku-42?preview=true');
  expect(html).not.toContain('Current URL: /products/sku-42?preview=true#details');
  expect(bootstrapPaths).toEqual(expect.arrayContaining([expect.stringMatching(/^\/assets\/entry-client-[a-zA-Z0-9_-]+\.js$/u)]));
  expect(stylesheetPaths).toHaveLength(1);

  for (const pathname of [...bootstrapPaths, ...stylesheetPaths]) {
    expect(assetResponses.get(pathname), `${pathname} should be served from the production asset route`).toBe(200);
  }

  expect([...assetResponses.keys()].some((pathname) => pathname.includes('/recommendations-'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-42' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recommendations' })).toHaveText('Recommended for sku-42');
  await expect(page.getByText('Current URL: /products/sku-42?preview=true#details')).toBeVisible();
  await expect(page.getByText('Current hash: #details')).toBeVisible();
  await expect(page.locator('[data-react-identifier]')).toHaveAttribute('id', /fluo-react-vite-/u);
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__softNavigationDocument = 'original'; });

  await page.getByRole('link', { name: 'Open sku-84' }).click();
  await expect(page).toHaveURL(/\/products\/sku-84\?preview=false$/u);
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-84' })).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('original');
  await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible();
  await expect(page.getByText('Current path: /products/sku-84')).toBeVisible();
  await expect(page.getByText('Current preview: false')).toBeVisible();

  await page.getByRole('button', { name: 'Push sku-126' }).click();
  await expect(page).toHaveURL(/\/products\/sku-126\?preview=true$/u);
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-126' })).toBeVisible();
  await expect(page.getByText('Current path: /products/sku-126')).toBeVisible();
  expect(browserDiagnostics).toEqual([]);
});

test('traverses admin QR and songs with a preserved shell, reset page state and focus', async ({ page }) => {
  // Given: a server-rendered admin page with shell and page-local state.
  const browserDiagnostics: string[] = [];
  page.on('pageerror', (error) => browserDiagnostics.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserDiagnostics.push(message.text());
    }
  });
  await page.goto('/admin/qr');
  await expect(page).toHaveTitle('Admin QR');
  await expect(page.getByText('Current route sku: unset')).toBeVisible();
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await page.getByRole('button', { name: 'Page count: 0' }).click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();
  await page.evaluate(() => { window.__softNavigationDocument = 'admin-shell'; });
  const navigationResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2',
  );

  // When: the ordinary Link moves to songs, then browser history visits QR and forward again.
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  const response = await navigationResponse;

  // Then: every view is HTTP-confirmed while shell identity and focus policy remain observable.
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/vnd\.fluo\.react-navigation\+json;\s*v="2"; charset=utf-8$/u);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toMatchObject({
    version: 2,
    buildId: expect.any(String),
    url: '/admin/songs',
    params: {},
    destination: { module: './navigation-admin.ts' },
  });
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await expect(page).toHaveTitle('Admin songs');
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await expect(page.getByText('Current path: /admin/songs')).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('admin-shell');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  await expect(page).toHaveTitle('Admin QR');
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 0' })).toBeVisible();
  await expect(page.getByText('Current path: /admin/qr')).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('admin-shell');
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await expect(page).toHaveTitle('Admin songs');
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  expect(browserDiagnostics).toEqual([]);
});

test('keeps native new tabs and full-document fallback on server rejection', async ({ page, context }) => {
  // Given: a hydrated page with a native anchor and a request rejected by HTTP validation.
  await page.goto('/admin/qr');
  const tabPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open admin songs' }).click({ modifiers: ['Meta'] });
  const tab = await tabPromise;
  await expect(tab.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await tab.close();
  await page.evaluate(() => { window.__softNavigationDocument = 'before-fallback'; });
  const rejected = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/x'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');

  // When: the regular Link requests a DTO-invalid destination.
  await page.getByRole('link', { name: 'Open invalid product' }).click();
  expect((await rejected).status()).toBe(400);

  // Then: no unapproved soft transition occurs; HTTP receives a document request.
  await expect(page).toHaveURL(/\/products\/x\?preview=maybe$/u);
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBeUndefined();
});

test('submits the native mutation form without client JavaScript', async ({ baseURL, browser }) => {
  // Given: an authorized browser context with JavaScript disabled.
  if (baseURL === undefined) {
    throw new TypeError('The browser test requires a configured base URL.');
  }

  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-example-user': 'catalog-editor' },
    javaScriptEnabled: false,
  });
  const page = await context.newPage();

  try {
    const admin = await page.goto('/admin/qr');
    expect(admin?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
    await page.getByRole('link', { name: 'Open admin songs' }).click();
    await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
    const initial = await page.goto('/products/sku-42?preview=true');
    expect(initial?.headers()['content-type']).toContain('text/html');
    await page.getByLabel('Product name').fill('No-script catalog item');
    const mutationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/products/sku-42',
    );

    // When: the browser submits the rendered HTML form.
    await page.getByRole('button', { name: 'Save product' }).click();
    const mutationResponse = await mutationResponsePromise;

    // Then: the POST redirects through the normal GET route in the no-JavaScript context.
    expect(mutationResponse.status()).toBe(303);
    expect(mutationResponse.headers().location).toBe('/products/sku-42?updated=true');
    await expect(page).toHaveURL(/\/products\/sku-42\?updated=true$/u);
    await expect(page.getByText('Saved product: No-script catalog item')).toBeVisible();
  } finally {
    await context.close();
  }
});
