import { expect, test } from '@playwright/test';

import { createDeferredSignal, nextNavigation, observeNavigation, openHydratedAdmin } from './prefetch-helpers';

const NAVIGATION_ACCEPT = 'application/vnd.fluo.react-navigation+json;v=2';

test('consumes an anonymous hover-prefetched public destination once', async ({ page }) => {
  // Given: the built document is hydrated and listeners are installed before pointer entry.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-84');
  const prefetch = nextNavigation(page, '/prefetch/public-84');

  // When: the pointer enters the opt-in anchor and then activates it.
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).hover();
  const response = await prefetch;
  expect(response.status()).toBe(200);
  expect(response.headers()['x-fluo-navigation-prefetch']).toBe('public');
  const requestHeaders = await response.request().allHeaders();
  expect(requestHeaders.cookie).toBeUndefined();
  expect(requestHeaders.authorization).toBeUndefined();
  await page.evaluate(() => { window.__softNavigationDocument = 'prefetched-shell'; });
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).click();

  // Then: one real GET supplied the approved result and the document remains mounted.
  await expect(page).toHaveURL(/\/prefetch\/public-84$/u);
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit \d+$/u })).toBeVisible();
  await expect(page.getByText('Current route scenario: public-84')).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('prefetched-shell');
  expect(requests).toHaveLength(1);
});

test('refreshes a consumed public entry on revisit and history traversal', async ({ page }) => {
  // Given: a completed hover prefetch that has already been consumed.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-84');
  const prefetch = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).hover();
  await prefetch;
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).click();
  const original = await page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u }).textContent();

  // When: the browser traverses away and back without a cached entry.
  const back = nextNavigation(page, '/admin/qr');
  await page.goBack();
  await back;
  const revisit = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).evaluate((anchor) => {
    if (anchor instanceof HTMLAnchorElement) anchor.click();
  });
  await revisit;

  // Then: HTTP approves the revisit rather than replaying the first rendering.
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u }))
    .not.toHaveText(original ?? '');
  const revisited = await page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u }).textContent();
  expect(requests).toHaveLength(2);

  const backAgain = nextNavigation(page, '/admin/qr');
  await page.goBack();
  await backAgain;
  const forward = nextNavigation(page, '/prefetch/public-84');
  await page.goForward();
  await forward;
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u }))
    .not.toHaveText(revisited ?? '');
  expect(requests).toHaveLength(3);
});

test('expires a completed entry before activation', async ({ page }) => {
  // Given: a public entry fetched with the browser clock installed before the opportunity.
  await openHydratedAdmin(page);
  await page.clock.install();
  const requests = observeNavigation(page, '/prefetch/public-84');
  const prefetch = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).hover();
  await prefetch;

  // When: the granted 15-second lifetime has elapsed before activation.
  await page.clock.fastForward(16_000);
  const navigation = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).click();
  await navigation;

  // Then: a second HTTP request approves the rendered page.
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u })).toBeVisible();
  expect(requests).toHaveLength(2);
});

test('deduplicates a completed viewport prefetch and a later hover', async ({ page }) => {
  // Given: the viewport link begins below the fold and the network listener is already active.
  await page.addInitScript(() => {
    const observe = IntersectionObserver.prototype.observe;
    IntersectionObserver.prototype.observe = function (element) {
      if (element instanceof HTMLAnchorElement && element.pathname === '/prefetch/public-viewport') {
        window.__viewportObserverSeen = true;
      }
      return observe.call(this, element);
    };
  });
  await openHydratedAdmin(page);
  expect(await page.evaluate(() => window.__viewportObserverSeen)).toBe(true);
  const requests = observeNavigation(page, '/prefetch/public-viewport');
  const prefetch = nextNavigation(page, '/prefetch/public-viewport');

  // When: the link intersects the viewport and another anchor hovers over the same destination.
  await page.getByRole('link', { name: 'Prefetch public on viewport' }).scrollIntoViewIfNeeded();
  expect((await prefetch).status()).toBe(200);
  await page.getByRole('link', { name: 'Prefetch public-viewport by hover' }).hover();
  await page.getByRole('link', { name: 'Prefetch public-viewport by hover' }).click();

  // Then: both opportunities and activation share one approved HTTP GET.
  await expect(page).toHaveURL(/\/prefetch\/public-viewport$/u);
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-viewport visit/u })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('adopts an in-flight hover request when the anchor is clicked', async ({ page }) => {
  // Given: a real GET paused at the browser's network boundary.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-race');
  const release = createDeferredSignal();
  await page.route('**/prefetch/public-race', async (route) => {
    await release.promise;
    await route.continue();
  });
  const prefetch = page.waitForRequest((request) =>
    request.method() === 'GET'
    && new URL(request.url()).pathname === '/prefetch/public-race'
    && request.headers().accept === NAVIGATION_ACCEPT);

  try {
    // When: the visitor activates the link while the prefetched GET is still pending.
    await page.getByRole('link', { name: 'Prefetch public race' }).hover();
    await prefetch;
    const activated = page.evaluate(() => new Promise<void>((resolve) => {
      document.querySelector('a[href="/prefetch/public-race"]')?.addEventListener('click', () => resolve(), { once: true });
    }));
    const click = page.getByRole('link', { name: 'Prefetch public race' }).click();
    await activated;
    release.resolve();
    await click;

    // Then: navigation adopts the original request without sending another GET.
    await expect(page).toHaveURL(/\/prefetch\/public-race$/u);
    await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-race visit/u })).toBeVisible();
    expect(requests).toHaveLength(1);
  } finally {
    release.resolve();
    await page.unroute('**/prefetch/public-race');
  }
});

declare global {
  interface Window {
    __softNavigationDocument?: string;
    __viewportObserverSeen?: boolean;
  }
}
