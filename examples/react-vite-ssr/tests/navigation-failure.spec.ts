import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __softNavigationDocument?: string;
    __originalResource?: Window['__reactResource'];
    __reactResource?: { readonly id: string; operate: () => string };
    __reactResourceStats?: { mounts: number; cleanups: number };
  }
}

const NAVIGATION_MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=2';

for (const reason of ['network', 'server-error'] as const) {
  test(`preserves a functional resource and approved page across ${reason} failure and fresh retry`, async ({ page }) => {
    // Given: a hydrated admin shell with one live resource and an HTTP-owned destination.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/admin/qr');
    await expect(page.getByRole('button', { name: 'Use shell resource' })).toBeVisible();
    await page.getByRole('button', { name: 'Use shell resource' }).click();
    const firstAck = await page.getByTestId('resource-ack').textContent();
    await page.evaluate(() => {
      window.__softNavigationDocument = 'resource-shell';
      window.__originalResource = window.__reactResource;
    });
    const destination = '/admin/songs';
    await page.route((url) => url.pathname === destination, async (route) => {
      if (route.request().headers().accept !== NAVIGATION_MEDIA_TYPE) {
        await route.continue();
        return;
      }
      if (reason === 'network') {
        await route.abort('failed');
      } else {
        await route.fulfill({ status: 503, body: 'private server trace' });
      }
    });
    const failedRequest = reason === 'network'
      ? page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === destination
        && request.headers().accept === NAVIGATION_MEDIA_TYPE)
      : page.waitForResponse((response) => new URL(response.url()).pathname === destination
        && response.status() === 503 && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);

    // When: navigation fails, resource operation continues and retry receives another HTTP decision.
    await page.getByRole('link', { name: 'Open admin songs' }).click();
    await failedRequest;
    await expect(page.getByRole('alert')).toContainText(`Navigation failed: ${reason}`);
    await expect(page).toHaveURL(/\/admin\/qr$/u);
    await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
    await page.getByRole('button', { name: 'Use shell resource' }).click();
    const secondAck = await page.getByTestId('resource-ack').textContent();
    expect(secondAck).not.toBe(firstAck);
    expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);
    await page.unrouteAll();
    const approved = page.waitForResponse((response) => new URL(response.url()).pathname === destination
      && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
    await page.getByRole('button', { name: 'Retry navigation' }).click();
    expect((await approved).status()).toBe(200);

    // Then: HTTP approval updates only the destination page; the same resource acknowledges another operation.
    await expect(page).toHaveURL(/\/admin\/songs$/u);
    await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('resource-shell');
    expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);
    await page.getByRole('button', { name: 'Use shell resource' }).click();
    expect(await page.getByTestId('resource-ack').textContent()).not.toBe(secondAck);
    expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
    expect(errors).toEqual([]);
  });
}

test('explicit document exit remains available after a preserved failure', async ({ page }) => {
  // Given: an opted-in shell with a transient destination failure.
  await page.goto('/admin/qr');
  await page.route((url) => url.pathname === '/admin/songs', (route) =>
    route.request().headers().accept === NAVIGATION_MEDIA_TYPE
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.continue());
  const rejected = page.waitForResponse((response) => response.status() === 503
    && new URL(response.url()).pathname === '/admin/songs');
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  await rejected;
  await expect(page.getByRole('alert')).toBeVisible();
  const document = page.waitForRequest((request) => new URL(request.url()).pathname === '/admin/songs'
    && request.headers().accept !== NAVIGATION_MEDIA_TYPE);

  // When: the user explicitly chooses the HTTP document instead.
  await page.getByRole('button', { name: 'Update application (open full document)' }).click();
  await document;

  // Then: the browser follows the ordinary server-rendered route.
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
});

test('failed back and forward restore the approved history entry and remain traversable', async ({ page }) => {
  // Given: two HTTP-approved pages sharing one shell and a real two-entry browser history.
  await page.goto('/admin/qr');
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await page.evaluate(() => { window.__originalResource = window.__reactResource; });
  await page.route((url) => url.pathname === '/admin/qr', (route) =>
    route.request().headers().accept === NAVIGATION_MEDIA_TYPE
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.continue());
  const rejectedBack = page.waitForResponse((response) => response.status() === 503
    && new URL(response.url()).pathname === '/admin/qr');

  // When: back activates a rejected page, then the user retries that traversal.
  await page.goBack({ waitUntil: 'commit' });
  await rejectedBack;
  await expect(page.getByRole('alert')).toContainText('server-error');
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await page.unrouteAll();
  const approvedBack = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/qr'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.getByRole('button', { name: 'Retry navigation' }).click();
  expect((await approvedBack).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);

  // Then: forward failure restores QR, and a second fresh retry restores normal traversal.
  await page.route((url) => url.pathname === '/admin/songs', (route) =>
    route.request().headers().accept === NAVIGATION_MEDIA_TYPE
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.continue());
  const rejectedForward = page.waitForResponse((response) => response.status() === 503
    && new URL(response.url()).pathname === '/admin/songs');
  await page.goForward({ waitUntil: 'commit' });
  await rejectedForward;
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  await expect(page.getByRole('alert')).toContainText('server-error');
  await page.unrouteAll();
  const retriedForward = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.getByRole('button', { name: 'Retry navigation' }).click();
  expect((await retriedForward).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  const retriedBack = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/qr'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.goBack({ waitUntil: 'commit' });
  expect((await retriedBack).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/qr$/u);

  // Ordinary forward and back still traverse precisely the approved entries.
  const forward = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.goForward({ waitUntil: 'commit' });
  expect((await forward).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  const back = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/qr'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.goBack({ waitUntil: 'commit' });
  expect((await back).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
});

test('invalidation during back approval restores the approved URL without remounting the shell', async ({ page }) => {
  // Given: an approved second page and a back request held before HTTP approval.
  await page.goto('/admin/qr');
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await page.evaluate(() => { window.__originalResource = window.__reactResource; });
  let releaseRequest = () => {};
  const heldRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route((url) => url.pathname === '/admin/qr', async (route) => {
    if (route.request().headers().accept !== NAVIGATION_MEDIA_TYPE) {
      await route.continue();
      return;
    }
    await heldRequest;
    await route.fulfill({ status: 503, body: 'late rejected approval' });
  });
  const pending = page.waitForRequest((request) => new URL(request.url()).pathname === '/admin/qr'
    && request.headers().accept === NAVIGATION_MEDIA_TYPE);

  // When: back changes the browser URL, then the retained shell invalidates the pending approval.
  await page.goBack({ waitUntil: 'commit' });
  await pending;
  await page.getByRole('button', { name: 'Invalidate prefetched pages' }).click();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  releaseRequest();

  // Then: the old page and live resource remain; ordinary traversal is still usable.
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page.getByText('Navigation: idle')).toBeVisible();
  expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
  await page.unrouteAll();
  const approved = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/qr'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.goBack({ waitUntil: 'commit' });
  expect((await approved).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/qr$/u);
});

test('default navigation invalidation loads the activated document for an untagged back entry', async ({ page }) => {
  // Given: the no-policy provider has approved a push, and a back request is held.
  await page.goto('/admin/qr?defaultNavigation=1');
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  const entries = await page.evaluate(() => history.length);
  expect(await page.evaluate(() => history.state)).toBeNull();
  await page.evaluate(() => { window.__softNavigationDocument = 'previous-shell'; });
  let releaseRequest = () => {};
  const heldRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route((url) => url.pathname === '/admin/qr', async (route) => {
    if (route.request().headers().accept !== NAVIGATION_MEDIA_TYPE) {
      await route.continue();
      return;
    }
    await heldRequest;
    await route.fulfill({ status: 503, body: 'late rejection' });
  });
  const pending = page.waitForRequest((request) => new URL(request.url()).pathname === '/admin/qr'
    && request.headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.goBack({ waitUntil: 'commit' });
  await pending;
  const document = page.waitForRequest((request) => new URL(request.url()).pathname === '/admin/qr'
    && request.headers().accept !== NAVIGATION_MEDIA_TYPE);

  // When: invalidation cancels approval while the untagged back entry is active.
  await page.getByRole('button', { name: 'Invalidate prefetched pages' }).click();
  await document;
  releaseRequest();

  // Then: a real document owns the URL and page without an extra history entry.
  await expect(page).toHaveURL(/\/admin\/qr\?defaultNavigation=1$/u);
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  await expect(page.getByText('Current path: /admin/qr')).toBeVisible();
  await expect(page.getByText('Current route sku: unset')).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBeUndefined();
  expect(await page.evaluate(() => history.length)).toBe(entries);
});

test('a rejected replace does not commit URL or params before retry', async ({ page }) => {
  // Given: a product destination whose negotiated response fails before history replacement.
  await page.goto('/admin/qr');
  await page.route((url) => url.pathname === '/products/sku-168', (route) =>
    route.request().headers().accept === NAVIGATION_MEDIA_TYPE
      ? route.fulfill({ status: 503, body: 'unavailable' })
      : route.continue());
  const rejected = page.waitForResponse((response) => response.status() === 503
    && new URL(response.url()).pathname === '/products/sku-168');

  // When: replace fails before retry succeeds.
  await page.getByRole('button', { name: 'Replace with sku-168' }).click();
  await rejected;
  await expect(page.getByRole('alert')).toContainText('server-error');
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  await expect(page.getByText('Current route sku: unset')).toBeVisible();
  await page.unrouteAll();
  const approved = page.waitForResponse((response) => new URL(response.url()).pathname === '/products/sku-168'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.getByRole('button', { name: 'Retry navigation' }).click();
  expect((await approved).status()).toBe(200);

  // Then: only the approved replacement installs HTTP-matched params and the new page.
  await expect(page).toHaveURL(/\/products\/sku-168\?preview=false$/u);
  await expect(page.getByText('Current route sku: sku-168')).toBeVisible();
});

test('repeated failures remain actionable without remounting the shell resource', async ({ page }) => {
  // Given: an observed live shell and a controllable HTTP rejection for every attempted move.
  await page.goto('/admin/qr');
  await expect(page.getByRole('button', { name: 'Use shell resource' })).toBeVisible();
  await page.evaluate(() => { window.__originalResource = window.__reactResource; });
  let onIntercept: ((reply: () => Promise<void>) => void) | undefined;
  let requests = 0;
  await page.route((url) => url.pathname === '/admin/songs', (route) => {
    if (route.request().headers().accept !== NAVIGATION_MEDIA_TYPE) {
      return route.continue();
    }
    requests++;
    onIntercept?.(() => route.fulfill({ status: 503, body: 'unavailable' }));
    return Promise.resolve();
  });

  // When: three independent failures are observed before retry actions continue.
  for (let attempt = 0; attempt < 3; attempt++) {
    const intercepted = new Promise<() => Promise<void>>((resolve) => { onIntercept = resolve; });
    const rejected = page.waitForResponse((response) => response.status() === 503
      && new URL(response.url()).pathname === '/admin/songs');
    if (attempt === 0) {
      await page.getByRole('link', { name: 'Open admin songs' }).click();
    } else {
      await page.getByRole('button', { name: 'Retry navigation' }).click();
    }
    const reply = await intercepted;
    await expect(page.getByText('Navigation: navigating')).toBeVisible();
    await reply();
    await rejected;
    await expect(page.getByText('Navigation: error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry navigation' })).toBeVisible();
  }

  // Then: the request count and resource lifetime remain bounded, and the next move succeeds.
  expect(requests).toBe(3);
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
  await page.unrouteAll();
  const approved = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === NAVIGATION_MEDIA_TYPE);
  await page.getByRole('button', { name: 'Retry navigation' }).click();
  expect((await approved).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).not.toBeEmpty();
  expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);
});

test('a recoverable chunk import failure keeps the page and offers document recovery', async ({ page }) => {
  // Given: HTTP approves the page, but its build-mapped browser module cannot load.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/products/sku-42');
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).not.toBeEmpty();
  await page.evaluate(() => { window.__originalResource = window.__reactResource; });
  await page.route((url) => /\/assets\/navigation-admin-[^/]+\.js$/u.test(url.pathname),
    (route) => route.abort('failed'));
  const failedChunk = page.waitForEvent('requestfailed', (request) =>
    /\/assets\/navigation-admin-[^/]+\.js$/u.test(new URL(request.url()).pathname));

  // When: navigation tries to import the approved chunk.
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  await failedChunk;

  // Then: a safe typed failure UI and still-functional resource remain until explicit exit.
  await expect(page.getByRole('alert')).toContainText('import-failure');
  await expect(page).toHaveURL(/\/products\/sku-42$/u);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-42' })).toBeVisible();
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).not.toBeEmpty();
  expect(await page.evaluate(() => window.__originalResource === window.__reactResource)).toBe(true);
  expect(errors).toEqual([]);
});
