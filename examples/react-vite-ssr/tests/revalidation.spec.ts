import { expect, test } from '@playwright/test';

const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=2';
const CURRENT = '/products/sku-42?preview=true';

test('revalidates external changes without replacing page history or the live shell', async ({ page }) => {
  // Given: a hydrated product page, a page-local counter, and a working persistent resource.
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  await page.goto(CURRENT);
  await expect(page.getByRole('button', { name: 'Count: 0', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  const originalAck = await page.getByTestId('resource-ack').textContent();
  const identity = await page.evaluate(() => window.__reactResource?.id);
  const length = await page.evaluate(() => history.length);
  const url = page.url();
  const changed = await page.request.post('/products/sku-42', {
    data: { name: 'Outside change' },
    headers: { 'x-example-user': 'catalog-editor' },
    maxRedirects: 0,
  });
  expect(changed.status()).toBe(303);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-42' })).toBeVisible();
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  let releaseRequest = () => {};
  const held = new Promise<void>((resolve) => { releaseRequest = resolve; });
  let requestStarted = () => {};
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route((target) => `${target.pathname}${target.search}` === CURRENT, async (route) => {
    if (route.request().headers().accept !== MEDIA_TYPE) return route.continue();
    requestStarted();
    await held;
    return route.continue();
  });
  const approved = page.waitForResponse((response) =>
    `${new URL(response.url()).pathname}${new URL(response.url()).search}` === CURRENT
    && response.request().headers().accept === MEDIA_TYPE);

  // When: a fresh same-page negotiated GET is held before HTTP approval.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await started;
  await expect(page.getByText('Navigation: refreshing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  releaseRequest();
  const response = await approved;
  expect(response.status()).toBe(200);

  // Then: changed data is visible, page-local state resets, and the original resource operates.
  await expect(page.getByRole('heading', { name: 'Browser destination: Outside change' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 0' })).toBeVisible();
  expect(response.request().headers().accept).toBe(MEDIA_TYPE);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(length);
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(identity);
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  expect(await page.getByTestId('resource-ack').textContent()).not.toBe(originalAck);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
  const nextPage = page.waitForResponse((result) =>
    new URL(result.url()).pathname === '/products/sku-126'
    && result.request().headers().accept === MEDIA_TYPE);
  await page.getByRole('button', { name: 'Push sku-126' }).click();
  expect((await nextPage).status()).toBe(200);
  const backApproval = page.waitForResponse((result) =>
    new URL(result.url()).pathname === '/products/sku-42'
    && result.request().headers().accept === MEDIA_TYPE);
  await page.goBack({ waitUntil: 'commit' });
  expect((await backApproval).status()).toBe(200);
  await expect(page).toHaveURL(/\/products\/sku-42\?preview=true$/u);
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(identity);
  expect(diagnostics).toEqual([]);
});

test('retains the last value on a failed refresh and retries through fresh HTTP', async ({ page }) => {
  // Given: an approved changed product and a transient server rejection on its next approval.
  await page.goto(CURRENT);
  await expect(page.getByRole('button', { name: 'Count: 0', exact: true })).toBeEnabled();
  const update = await page.request.post('/products/sku-42', {
    data: { name: 'Retry approved name' },
    headers: { 'x-example-user': 'catalog-editor' },
    maxRedirects: 0,
  });
  expect(update.status()).toBe(303);
  await page.route((target) => `${target.pathname}${target.search}` === CURRENT, (route) =>
    route.request().headers().accept === MEDIA_TYPE
      ? route.fulfill({ status: 503, body: 'private server details' })
      : route.continue());
  const denied = page.waitForResponse((response) => response.status() === 503
    && response.request().headers().accept === MEDIA_TYPE);

  // When: refresh fails, then the shell's retry requests a fresh approval.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await denied;
  await expect(page.getByRole('alert')).toContainText('server-error');
  await expect(page.getByRole('heading', { name: 'Catalog item sku-42' })).toBeVisible();
  await page.unrouteAll();
  const approved = page.waitForResponse((response) => response.status() === 200
    && response.request().headers().accept === MEDIA_TYPE
    && new URL(response.url()).pathname === '/products/sku-42');
  await page.getByRole('button', { name: 'Retry navigation' }).click();
  await approved;

  // Then: only the newly approved value replaces the retained page.
  await expect(page.getByRole('heading', { name: 'Browser destination: Retry approved name' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
});

test('a second refresh supersedes a held older HTTP approval without losing the shell', async ({ page }) => {
  // Given: the first credentialed response is captured but withheld from the browser.
  const path = '/products/sku-race-3873?preview=true';
  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Count: 0', exact: true })).toBeEnabled();
  const resourceId = await page.evaluate(() => window.__reactResource?.id);
  const update = (name: string) => page.request.post('/products/sku-race-3873', {
    data: { name },
    headers: { 'x-example-user': 'catalog-editor' },
    maxRedirects: 0,
  });
  expect((await update('Earlier approved name')).status()).toBe(303);
  let captured = () => {};
  const firstCaptured = new Promise<void>((resolve) => { captured = resolve; });
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let finished = () => {};
  const firstFinished = new Promise<void>((resolve) => { finished = resolve; });
  let requests = 0;
  await page.route((url) => `${url.pathname}${url.search}` === path, async (route) => {
    if (route.request().headers().accept !== MEDIA_TYPE) return route.continue();
    requests++;
    if (requests !== 1) return route.continue();
    try {
      const earlier = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response: earlier }).catch((error: unknown) => {
        if (!route.request().failure()) throw error;
      });
    } finally {
      finished();
    }
  });
  const approved = page.waitForResponse((response) =>
    `${new URL(response.url()).pathname}${new URL(response.url()).search}` === path
    && response.request().headers().accept === MEDIA_TYPE);

  // When: fresh backing data arrives and a second refresh aborts the held first request.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await firstCaptured;
  await expect(page.getByText('Navigation: refreshing')).toBeVisible();
  expect((await update('Latest approved name')).status()).toBe(303);
  await page.getByRole('button', { name: 'Refresh' }).click();
  expect((await approved).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Browser destination: Latest approved name' })).toBeVisible();
  release();
  await firstFinished;

  // Then: obsolete HTTP approval never overwrites the latest page or reloads its resource.
  expect(requests).toBe(2);
  await expect(page.getByRole('heading', { name: 'Browser destination: Latest approved name' })).toBeVisible();
  expect(page.url()).toContain(path);
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resourceId);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
});

test('refresh during an unapproved back restores the approved page before failure and retry', async ({ page }) => {
  // Given: two approved entries and an exact back request held before approval.
  const previous = '/products/sku-42?preview=true';
  const current = '/products/sku-126?preview=true';
  await page.goto(previous);
  await expect(page.getByRole('button', { name: 'Count: 0', exact: true })).toBeEnabled();
  const resource = await page.evaluate(() => window.__reactResource?.id);
  await page.getByRole('button', { name: 'Push sku-126' }).click();
  await expect(page).toHaveURL(new RegExp(`${current.replace('?', '\\?')}$`, 'u'));
  let releaseBack = () => {};
  const backHeld = new Promise<void>((resolve) => { releaseBack = resolve; });
  let backStarted = () => {};
  const started = new Promise<void>((resolve) => { backStarted = resolve; });
  await page.route((url) => `${url.pathname}${url.search}` === previous, async (route) => {
    if (route.request().headers().accept !== MEDIA_TYPE) return route.continue();
    backStarted();
    await backHeld;
    if (!route.request().failure()) {
      await route.continue().catch((error: unknown) => {
        if (!route.request().failure()) throw error;
      });
    }
  });
  const backRequest = page.waitForRequest((request) =>
    `${new URL(request.url()).pathname}${new URL(request.url()).search}` === previous
    && request.headers().accept === MEDIA_TYPE);
  await page.evaluate(() => history.back());
  await backRequest;
  await started;
  await expect(page.getByText('Navigation: navigating')).toBeVisible();
  await page.route((url) => `${url.pathname}${url.search}` === current, (route) =>
    route.request().headers().accept === MEDIA_TYPE
      ? route.fulfill({ status: 503, body: 'private server details' })
      : route.continue());
  const denied = page.waitForResponse((response) => response.status() === 503
    && response.request().headers().accept === MEDIA_TYPE
    && `${new URL(response.url()).pathname}${new URL(response.url()).search}` === current);

  // When: refresh cancels back, restores the approved entry, then receives a preserved failure.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await denied;
  await expect(page.getByRole('alert')).toContainText('server-error');
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(current);
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-126' })).toBeVisible();
  releaseBack();
  await page.unrouteAll();
  const retried = page.waitForResponse((response) => response.status() === 200
    && response.request().headers().accept === MEDIA_TYPE
    && `${new URL(response.url()).pathname}${new URL(response.url()).search}` === current);
  await page.getByRole('button', { name: 'Retry navigation' }).click();
  await retried;

  // Then: retry and subsequent back/forward keep entry order and the shell resource.
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-126' })).toBeVisible();
  const backApproved = page.waitForResponse((response) => response.status() === 200
    && response.request().headers().accept === MEDIA_TYPE
    && `${new URL(response.url()).pathname}${new URL(response.url()).search}` === previous);
  await page.goBack();
  await backApproved;
  await expect(page).toHaveURL(new RegExp(`${previous.replace('?', '\\?')}$`, 'u'));
  const forwardApproved = page.waitForResponse((response) => response.status() === 200
    && response.request().headers().accept === MEDIA_TYPE
    && `${new URL(response.url()).pathname}${new URL(response.url()).search}` === current);
  await page.goForward();
  await forwardApproved;
  await expect(page).toHaveURL(new RegExp(`${current.replace('?', '\\?')}$`, 'u'));
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resource);
  expect(await page.evaluate(() => window.__reactResourceStats)).toEqual({ mounts: 1, cleanups: 0 });
});
