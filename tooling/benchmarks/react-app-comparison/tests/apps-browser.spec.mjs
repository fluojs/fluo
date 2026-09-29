import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import { PRODUCTS, SESSION_COOKIE, SONGS } from '../fixture/domain.mjs';

const baseline = JSON.parse(await readFile(new URL('../baseline.json', import.meta.url), 'utf8'));
const profileIds = [
  'desktop-native',
  'desktop-matched-cache',
  'tablet-native',
  'tablet-matched-cache',
];

test('the missing-product response displays an error in the production browser', async ({ page }) => {
  // Given: the seeded catalog has no product at this URL.
  // When: a visitor opens the real missing-product document.
  const response = await page.goto('/products/not-found', { waitUntil: 'domcontentloaded' });
  // Then: HTTP failure also produces usable browser text, even if body has no layout box.
  expect(response?.status()).toBe(404);
  const text = await page.locator('body').evaluate((body) => body.innerText.trim());
  expect(text.length).toBeGreaterThan(0);
});

test('Next products expose client hydration before development edits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'next');
  const response = await page.goto('/products', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('.eyebrow')).toHaveText('Product catalog');
  await expect(page.locator('[data-benchmark-hydrated="true"]')).toBeAttached();
});

test('public listing, detail, and production asset budgets', async ({ page }, testInfo) => {
  // Given: a fresh production browser observing its actual network responses.
  const assets = [];
  const responses = [];
  page.on('response', (response) => {
    responses.push(response);
    if (/\.(?:js|css)(?:\?|$)/u.test(new URL(response.url()).pathname)) assets.push(response);
  });

  // When: the anonymous visitor opens the real SSR listing.
  const navigation = await page.goto('/');
  expect(navigation?.status()).toBe(200);

  // Then: the seeded catalog and route-specific detail are visible.
  for (const product of PRODUCTS) {
    await expect(page.getByText(product.name).first()).toBeVisible();
    await expect(page.locator(`a[href="/products/${product.sku}"]`).first()).toBeVisible();
  }
  const listingAssets = [...assets];
  const listingRequests = responses.length;
  if (testInfo.project.name === 'fluo') {
    expect(listingAssets.length).toBeGreaterThan(0);
    for (const asset of listingAssets) {
      expect((await asset.allHeaders())['content-encoding']).toBe('gzip');
    }
  }
  await page.locator(`a[href="/products/${PRODUCTS[0].sku}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/products/${PRODUCTS[0].sku}$`, 'u'));
  await expect(page.getByText(PRODUCTS[0].name).first()).toBeVisible();

  // Given: a settled production response inventory, account for actual delivered assets.
  const sizes = { javascript: 0, css: 0 };
  for (const response of listingAssets) {
    if (!response.ok()) continue;
    const bytes = (await response.body()).byteLength;
    if (/\.css(?:\?|$)/u.test(new URL(response.url()).pathname)) sizes.css += bytes;
    else sizes.javascript += bytes;
  }
  for (const profileId of profileIds) {
    const budget = baseline.profiles[profileId].absoluteBudgets;
    expect(listingRequests, `${profileId} listing request count`).toBeLessThanOrEqual(budget.requestCount);
    expect(sizes.javascript, `${profileId} uncompressed JS bytes`).toBeLessThanOrEqual(budget.transferredJsBytes);
    expect(sizes.css, `${profileId} uncompressed CSS bytes`).toBeLessThanOrEqual(budget.transferredCssBytes);
  }
});

test('auth, validation, mutation, and logout use real production forms', async ({ page, request }) => {
  // Given: a public session has neither write permission nor an editor cookie.
  const forbidden = await request.post('/products', { form: { name: 'Forbidden item' }, maxRedirects: 0 });
  expect(forbidden.status()).toBe(403);
  const rejected = await request.post('/login', {
    form: { username: 'editor', password: 'incorrect' },
    maxRedirects: 0,
  });
  expect(rejected.status()).toBe(401);

  // When: the editor signs in using an ordinary browser form.
  await page.goto('/login');
  const loginForm = page.locator('form[action="/login"]:has(input[name="username"])');
  await expect(loginForm).toHaveAttribute('method', /post/iu);
  await loginForm.locator('input[name="username"]').fill('editor');
  await loginForm.locator('input[name="password"]').fill('benchmark-pass');
  const loginResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
  await loginForm.locator('button[type="submit"]').click();
  expect((await loginResponse).status()).toBe(303);
  await expect(page).toHaveURL(/\/admin\/products$/u);
  const cookies = await page.context().cookies();
  const session = cookies.find((entry) => entry.name === SESSION_COOKIE);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  const headers = { cookie: `${SESSION_COOKIE}=${session.value}` };

  // Then: invalid writes fail; native form redirects lead to current created and edited data.
  const invalid = await request.post('/products', { headers, form: { name: 'x' }, maxRedirects: 0 });
  expect(invalid.status()).toBe(400);
  await page.locator('form[action="/products"] input[name="name"]').fill('Created product');
  const createResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products' && response.request().method() === 'POST');
  await page.locator('form[action="/products"] button[type="submit"]').click();
  expect((await createResponse).status()).toBe(303);
  await expect(page).toHaveURL(/\/products\/sku-\d+$/u);
  await expect(page.getByText('Created product').first()).toBeVisible();
  const location = new URL(page.url()).pathname;
  const detail = await request.get(location, { headers });
  expect(detail.headers()['cache-control']).toBe('no-store');
  expect(await detail.text()).toContain('Created product');
  const editForm = page.locator(`form[action="${location}"]:has(input[name="name"])`);
  await expect(editForm).toHaveAttribute('method', /post/iu);
  await editForm.locator('input[name="name"]').fill('Updated product');
  await editForm.locator('button[type="submit"]').click();
  await expect(page.getByText('Updated product').first()).toBeVisible();
  await page.locator(`form[action="${location}/delete"] button[type="submit"]`).click();
  expect((await request.get(location)).status()).toBe(404);
  await page.goto('/admin/products');
  const logoutResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/logout' && response.request().method() === 'POST');
  await page.locator('form[action="/logout"] button[type="submit"]').first().click();
  expect((await logoutResponse).status()).toBe(303);
  await expect(page).toHaveURL(/\/products$|\/$/u);
  expect((await page.context().cookies()).some((entry) => entry.name === SESSION_COOKIE)).toBe(false);
});

test('jukebox retains one usable browser resource through client navigation', async ({ page }) => {
  // Given: the jukebox shell and real audio resource mount in a production browser.
  const browserErrors = [];
  const documentRequests = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    if (request.isNavigationRequest()) documentRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const response = await page.goto('/jukebox/songs');
  expect(response?.status()).toBe(200);
  for (const song of SONGS) await expect(page.getByText(song.title).first()).toBeVisible();
  const resource = page.getByTestId('jukebox-resource');
  await expect(resource).toBeVisible();
  await expect(resource).toHaveAttribute('data-benchmark-hydrated', 'true');
  await expect(page.locator('[data-approved-view="songs"]')).toBeVisible();
  await expect(resource).toHaveAttribute('data-instance', /.+/u);
  const identity = await resource.getAttribute('data-instance');
  expect(identity).toBeTruthy();
  await page.evaluate(() => { window.__benchmarkDocument = 'jukebox-shell'; });
  await page.evaluate(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    window.__benchmarkMediaStarted = new Promise((resolve) => {
      HTMLMediaElement.prototype.play = function (...args) {
        resolve();
        return originalPlay.apply(this, args);
      };
    });
  });

  // When: a resource operation completes before and after route transitions.
  await page.getByTestId('jukebox-operation').click();
  await page.evaluate(() => Promise.race([
    window.__benchmarkMediaStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('No audio playback was attempted.')), 5_000)),
  ]));
  await expect(page.getByTestId('jukebox-ack'), browserErrors.join('\n')).toHaveText('1');
  const jukeboxNav = page.locator('nav[aria-label="Jukebox views"]');
  const navigation = await jukeboxNav.count() ? jukeboxNav : page.locator('nav[aria-label="Main navigation"]');
  for (const view of ['qr', 'queue', 'songs']) {
    await navigation.locator(`a[href="/jukebox/${view}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/jukebox/${view}$`, 'u'));
    expect(await page.evaluate(() => window.__benchmarkDocument), [view, ...browserErrors, ...documentRequests].join('\n')).toBe('jukebox-shell');
    await expect(page.locator(`[data-approved-view="${view}"]`)).toBeVisible();
    await expect(page.getByTestId('jukebox-resource')).toHaveAttribute('data-instance', identity);
    for (const song of SONGS) await expect(page.getByText(song.title).first()).toBeVisible();
  }
  await page.getByTestId('jukebox-operation').click();
  await expect(page.getByTestId('jukebox-ack')).toHaveText('2');
  expect(browserErrors).toEqual([]);
});
