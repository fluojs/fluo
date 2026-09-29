import { expect, test } from '@playwright/test';

import { nextNavigation, observeNavigation, openHydratedAdmin } from './prefetch-helpers';

test('denied prefetch never replaces credentialed navigation', async ({ page }) => {
  // Given: an opt-in anchor to a page with an existing private cache policy.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/no-store');
  const prefetch = nextNavigation(page, '/prefetch/no-store');

  // When: hover receives a denied result and the visitor activates the anchor.
  await page.getByRole('link', { name: 'Prefetch no-store' }).hover();
  expect((await prefetch).headers()['x-fluo-navigation-prefetch']).toBeUndefined();
  const navigation = nextNavigation(page, '/prefetch/no-store');
  await page.getByRole('link', { name: 'Prefetch no-store' }).click();
  await navigation;

  // Then: a fresh HTTP GET renders the destination rather than consuming denial.
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch no-store visit/u })).toBeVisible();
  expect(requests).toHaveLength(2);
});

for (const [scenario, label] of [
  ['private', 'Prefetch private'],
  ['set-cookie', 'Prefetch Set-Cookie'],
  ['vary-cookie', 'Prefetch Vary Cookie'],
] as const) {
  test(`rejects ${scenario} prefetch and loads a fresh document destination`, async ({ page }) => {
    // Given: the server fixture denies reuse for its own response policy.
    await openHydratedAdmin(page);
    const requests = observeNavigation(page, `/prefetch/${scenario}`);
    const prefetch = nextNavigation(page, `/prefetch/${scenario}`);

    // When: hover completes and the same link is clicked.
    await page.getByRole('link', { name: label }).hover();
    expect((await prefetch).headers()['x-fluo-navigation-prefetch']).toBeUndefined();
    const navigation = nextNavigation(page, `/prefetch/${scenario}`);
    await page.getByRole('link', { name: label }).click();
    await navigation;

    // Then: a fresh request, not the denied response, renders the destination.
    await expect(page.getByRole('heading', { name: new RegExp(`Browser destination: Prefetch ${scenario} visit`, 'u') }))
      .toBeVisible();
    expect(requests).toHaveLength(2);
  });
}

test('invalidates anonymous entries when the application switches users', async ({ page }) => {
  // Given: the current provider has a completed anonymous prefetch.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-84');
  const prefetch = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).hover();
  await prefetch;

  // When: the application changes the cookie and its explicit session epoch.
  await page.getByRole('button', { name: 'Switch user and prefetch scope' }).click();
  const navigation = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).evaluate((anchor) => {
    if (anchor instanceof HTMLAnchorElement) anchor.click();
  });
  const response = await navigation;

  // Then: HTTP receives the user's credential on a new navigation, not the old payload.
  expect((await response.request().allHeaders()).cookie).toContain('session=alice');
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u })).toBeVisible();
  expect(requests).toHaveLength(2);
});

test('rejects anonymous auth prefetch and navigates with the active session', async ({ page }) => {
  // Given: a session established by the application boundary.
  await openHydratedAdmin(page);
  await page.getByRole('button', { name: 'Switch user and prefetch scope' }).click();
  const requests = observeNavigation(page, '/prefetch/auth');
  const prefetch = nextNavigation(page, '/prefetch/auth');

  // When: the anonymous prefetch fails but normal activation carries the session.
  await page.getByRole('link', { name: 'Prefetch auth' }).hover();
  expect((await prefetch).status()).toBe(403);
  const navigation = nextNavigation(page, '/prefetch/auth');
  await page.getByRole('link', { name: 'Prefetch auth' }).click();
  expect((await navigation).status()).toBe(200);

  // Then: the authenticated destination renders without reusing the rejection.
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch auth visit/u })).toBeVisible();
  expect(requests).toHaveLength(2);
});

test('invalidates completed prefetch after an in-document mutation', async ({ page }) => {
  // Given: a completed public prefetch precedes a real guarded POST.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-84');
  const prefetch = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).hover();
  await prefetch;
  const mutation = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/products/sku-42');

  // When: the native HTTP mutation succeeds and the app calls router.invalidate().
  await page.getByRole('button', { name: 'Rename without reload' }).click();
  expect((await mutation).status()).toBe(303);
  await expect(page.getByRole('status').filter({
    hasText: 'Mutation completed; prefetched pages invalidated',
  })).toHaveText('Mutation completed; prefetched pages invalidated');
  const navigation = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Prefetch public sku-84' }).evaluate((anchor) => {
    if (anchor instanceof HTMLAnchorElement) anchor.click();
  });
  await navigation;

  // Then: the pre-mutation entry cannot satisfy activation.
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u })).toBeVisible();
  expect(requests).toHaveLength(2);
});

test('leaves the default Link without speculative GETs', async ({ page }) => {
  // Given: a Link without any prefetch option.
  await openHydratedAdmin(page);
  const requests = observeNavigation(page, '/prefetch/public-84');

  // When: the pointer enters and activates the normal anchor.
  await page.getByRole('link', { name: 'Open public sku-84 without prefetch' }).hover();
  const navigation = nextNavigation(page, '/prefetch/public-84');
  await page.getByRole('link', { name: 'Open public sku-84 without prefetch' }).click();
  await navigation;

  // Then: one credentialed navigation GET renders the page.
  await expect(page.getByRole('heading', { name: /Browser destination: Prefetch public-84 visit/u })).toBeVisible();
  expect(requests).toHaveLength(1);
});

for (const [scenario, label, status, destination] of [
  ['redirect', 'Prefetch redirect', 302, /\/admin\/songs$/u],
  ['missing', 'Prefetch missing', 404, /\/prefetch\/missing$/u],
] as const) {
  test(`falls back to a document for ${scenario} rather than caching a denial`, async ({ page }) => {
    // Given: the server cannot provide an approved JSON destination for this link.
    await openHydratedAdmin(page);
    const requests = observeNavigation(page, `/prefetch/${scenario}`);
    const prefetch = nextNavigation(page, `/prefetch/${scenario}`);

    // When: speculative GET is denied and the anchor is activated.
    await page.getByRole('link', { name: label }).hover();
    expect((await prefetch).status()).toBe(status);
    const navigation = nextNavigation(page, `/prefetch/${scenario}`);
    await page.getByRole('link', { name: label }).click();
    expect((await navigation).status()).toBe(status);

    // Then: no soft route is committed and the ordinary document owns the result.
    await expect(page).toHaveURL(destination);
    expect(requests).toHaveLength(2);
    if (scenario === 'redirect') {
      await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
    }
  });
}
