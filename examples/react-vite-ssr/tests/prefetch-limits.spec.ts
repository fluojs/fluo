import { expect, test } from '@playwright/test';

import { createDeferredSignal, nextNavigation, observeNavigation, openHydratedAdmin } from './prefetch-helpers';

test('skips a fifth opportunity while four real viewport GETs are pending', async ({ page }) => {
  // Given: five simultaneous viewport opportunities with all network responses held open.
  const release = createDeferredSignal();
  const fourStarted = createDeferredSignal();
  let started = 0;
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/prefetch/public-bound-')) {
      requests.push(new URL(request.url()).pathname);
    }
  });
  await page.route('**/prefetch/public-bound-*', async (route) => {
    started += 1;
    if (started === 4) {
      fourStarted.resolve();
    }
    await release.promise;
    if (route.request().failure() === null) {
      await route.continue();
    }
  });

  try {
    // When: the hydrated document observes all five links together.
    await openHydratedAdmin(page, '?prefetchBounds=true');
    await fourStarted.promise;

    // Then: only four GETs enter the browser network stack before completion.
    expect(requests).toHaveLength(4);
    const skippedIndex = [1, 2, 3, 4, 5].find(
      (index) => !requests.includes(`/prefetch/public-bound-${index}`),
    );
    if (skippedIndex === undefined) {
      throw new Error('Four concurrent prefetches must leave one opportunity unrequested.');
    }
    const skippedPath = `/prefetch/public-bound-${skippedIndex}`;
    release.resolve();
    const navigation = nextNavigation(page, skippedPath);
    await page.getByRole('link', { name: `Viewport bound ${skippedIndex}` }).evaluate((anchor) => {
      if (anchor instanceof HTMLAnchorElement) anchor.click();
    });
    await navigation;
    await expect(page).toHaveURL(new RegExp(`${skippedPath}$`, 'u'));
    await expect(page.getByRole('heading', {
      name: new RegExp(`Browser destination: Prefetch public-bound-${skippedIndex} visit`, 'u'),
    }))
      .toBeVisible();
    expect(requests.filter((pathname) => pathname === skippedPath)).toHaveLength(1);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('evicts the oldest completed entry after 33 distinct public prefetches', async ({ page }) => {
  test.setTimeout(90_000);
  // Given: 33 independent opt-in anchors and a session cookie used only by normal navigation.
  await openHydratedAdmin(page, '?prefetchBounds=cache');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => { document.cookie = 'session=alice; Path=/'; });
  const firstRequests = observeNavigation(page, '/prefetch/public-cache-1');
  const lastRequests = observeNavigation(page, '/prefetch/public-cache-33');

  // When: each hover receives an actual server-approved response before the next starts.
  for (let index = 1; index <= 33; index += 1) {
    const path = `/prefetch/public-cache-${index}`;
    const approved = nextNavigation(page, path);
    await page.getByRole('link', { name: `Cache entry ${index}`, exact: true }).hover();
    const response = await approved;
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-fluo-navigation-prefetch'], path).toBe('public');
    expect((await response.request().allHeaders()).cookie, path).toBeUndefined();
    await response.finished();
  }
  expect(firstRequests).toHaveLength(1);
  expect(lastRequests).toHaveLength(1);

  // Then: the newest entry is consumable without another GET, proving insertion completed.
  await page.getByRole('link', { name: 'Cache entry 33', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Browser destination: Prefetch public-cache-33 visit 1' }))
    .toBeVisible();
  expect(lastRequests).toHaveLength(1);
  const back = nextNavigation(page, '/admin/qr');
  await page.goBack();
  await back;

  // The oldest entry was evicted; keyboard activation cannot accidentally start a new hover.
  const fresh = nextNavigation(page, '/prefetch/public-cache-1');
  await page.getByRole('link', { name: 'Cache entry 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  const response = await fresh;
  expect((await response.request().allHeaders()).cookie).toContain('session=alice');
  await expect(page.getByRole('heading', { name: 'Browser destination: Prefetch public-cache-1 visit 2' }))
    .toBeVisible();
  expect(firstRequests).toHaveLength(2);
});

test('cancels a hover request on leave without committing or falling back', async ({ page }) => {
  // Given: the prefetch network request is held open before any response arrives.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-cancel');
  const release = createDeferredSignal();
  await page.route('**/prefetch/public-cancel', async (route) => {
    await release.promise;
    if (route.request().failure() === null) {
      await route.continue();
    }
  });
  const prefetch = page.waitForRequest((request) =>
    request.method() === 'GET' && new URL(request.url()).pathname === '/prefetch/public-cancel');
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.method() === 'GET'
      && new URL(request.url()).pathname === '/prefetch/public-cancel',
  });

  try {
    // When: the pointer leaves before HTTP can answer.
    await page.getByRole('link', { name: 'Prefetch public cancellation' }).hover();
    await prefetch;
    await page.mouse.move(0, 0);
    release.resolve();
    await cancelled;

    // Then: no URL change or fallback occurs; a later ordinary click makes a new GET.
    await expect(page).toHaveURL(/\/admin\/qr$/u);
    const navigation = nextNavigation(page, '/prefetch/public-cancel');
    await page.getByRole('link', { name: 'Open cancelled destination without prefetch' }).click();
    await navigation;
    await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-cancel visit/u })).toBeVisible();
    expect(requests).toHaveLength(2);
  } finally {
    release.resolve();
    await page.unroute('**/prefetch/public-cancel');
  }
});
