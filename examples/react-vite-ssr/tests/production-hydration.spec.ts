import { expect, test } from '@playwright/test';

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
  expect(bootstrapPaths).toContain('/assets/entry-client.js');
  expect(stylesheetPaths).toHaveLength(1);

  for (const pathname of [...bootstrapPaths, ...stylesheetPaths]) {
    expect(assetResponses.get(pathname), `${pathname} should be served from the production asset route`).toBe(200);
  }

  expect([...assetResponses.keys()].some((pathname) => pathname.includes('/recommendations-'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-42' })).toBeVisible();
  await expect(page.getByText('Recommended for sku-42')).toBeVisible();
  await expect(page.getByText('Current URL: /products/sku-42?preview=true#details')).toBeVisible();
  await expect(page.getByText('Current hash: #details')).toBeVisible();
  await expect(page.locator('[data-react-identifier]')).toHaveAttribute('id', /fluo-react-vite-/u);
  await page.getByRole('button', { name: 'Count: 0' }).click();
  await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible();

  await page.getByRole('link', { name: 'Open sku-84' }).click();
  await expect(page).toHaveURL(/\/products\/sku-84\?preview=false$/u);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-84' })).toBeVisible();
  await expect(page.getByText('Current path: /products/sku-84')).toBeVisible();
  await expect(page.getByText('Current preview: false')).toBeVisible();

  await page.getByRole('button', { name: 'Push sku-126' }).click();
  await expect(page).toHaveURL(/\/products\/sku-126\?preview=true$/u);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-126' })).toBeVisible();
  await expect(page.getByText('Current path: /products/sku-126')).toBeVisible();
  expect(browserDiagnostics).toEqual([]);
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
    await page.goto('/products/sku-42?preview=true');
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
