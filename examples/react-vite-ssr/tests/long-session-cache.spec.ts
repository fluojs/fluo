import { expect, test } from '@playwright/test';
import { acknowledge, gate, navigationMedia } from './long-session-helpers';
import { installObserver, settled, watchText } from './long-session-observer';

test('repeated public cache cycles preserve 32 entries single use and the 64 KiB entry ceiling', async ({ page }) => {
  // Given: actual opt-in Links and HTTP/public grants in one hydrated document.
  test.setTimeout(180_000);
  await installObserver(page);
  await page.goto('/admin/qr?prefetchBounds=cache', { waitUntil: 'domcontentloaded' });
  await acknowledge(page, 1);
  // Only Date is fixed; observer deadlines and network events continue normally.
  await page.clock.setFixedTime(new Date());
  const counts = new Map<string, number>();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/prefetch/public-cache-')) counts.set(path, (counts.get(path) ?? 0) + 1);
  });
  let sequence = 1;
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: 'Invalidate prefetched pages', exact: true }).click();
    let latestName = '';
    // When: 33 real anonymous grants enter the existing provider-owned LRU.
    for (let entry = 1; entry <= 33; entry++) {
      const path = `/prefetch/public-cache-${entry}`;
      const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === path
        && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
      await page.getByRole('link', { name: `Cache entry ${entry}`, exact: true }).hover();
      const grant = await response;
      expect(grant.status()).toBe(200);
      expect(grant.headers()['x-fluo-navigation-prefetch']).toBe('public');
      expect((await grant.request().allHeaders()).cookie).toBeUndefined();
      const payload = await grant.json();
      if (entry === 33) latestName = payload.destination.props.productName;
      await grant.finished();
    }
    await page.mouse.move(0, 0);
    const lastBefore = counts.get('/prefetch/public-cache-33');
    const selected = await watchText(page, '#page-slot', latestName);
    await page.getByRole('link', { name: 'Cache entry 33', exact: true }).evaluate((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing cache entry Link');
      anchor.click();
    });
    await settled(page, selected);
    // Then: newest cache entry is consumed once without a second GET.
    expect(counts.get('/prefetch/public-cache-33')).toBe(lastBefore);
    const back = await watchText(page, 'nav p', 'Current path: /admin/qr');
    const approval = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/admin/qr'
      && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
    await page.goBack({ waitUntil: 'commit' }); await approval; await settled(page, back);
    const revisit = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/prefetch/public-cache-33'
      && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
    const usedAgain = await watchText(page, '#page-slot', 'Prefetch public-cache-33');
    await page.getByRole('link', { name: 'Cache entry 33', exact: true }).evaluate((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing cache entry Link');
      anchor.click();
    });
    await revisit; await settled(page, usedAgain);
    expect(counts.get('/prefetch/public-cache-33')).toBe((lastBefore ?? 0) + 1);
    const returnAfterUse = await watchText(page, 'nav p', 'Current path: /admin/qr');
    await page.goBack({ waitUntil: 'commit' }); await settled(page, returnAfterUse);
    const oldestBefore = counts.get('/prefetch/public-cache-1') ?? 0;
    const fresh = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/prefetch/public-cache-1'
      && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
    const oldest = await watchText(page, '#page-slot', 'Prefetch public-cache-1');
    await page.getByRole('link', { name: 'Cache entry 1', exact: true }).evaluate((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing cache entry Link');
      anchor.click();
    });
    await fresh; await settled(page, oldest);
    expect(counts.get('/prefetch/public-cache-1')).toBe(oldestBefore + 1);
    const returnPage = await watchText(page, 'nav p', 'Current path: /admin/qr');
    await page.goBack({ waitUntil: 'commit' }); await settled(page, returnPage);
    await acknowledge(page, ++sequence);
  }
  // Oversized wire bytes remain an anonymous speculation rejection, not a cache entry.
  await page.getByRole('button', { name: 'Invalidate prefetched pages', exact: true }).click();
  expect((await page.request.post('/__reliability/oversized/arm')).ok()).toBe(true);
  const oversizedResponse = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/prefetch/public-cache-1',
    { timeout: 10_000 });
  await page.getByRole('link', { name: 'Cache entry 1', exact: true }).hover();
  await oversizedResponse;
  const fresh = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/prefetch/public-cache-1',
    { timeout: 10_000 });
  const approved = await watchText(page, '#page-slot', 'Prefetch public-cache-1');
  await page.mouse.move(0, 0);
  await page.getByRole('link', { name: 'Cache entry 1', exact: true }).evaluate((anchor) => {
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing cache entry Link');
    anchor.click();
  });
  await fresh; await settled(page, approved); await acknowledge(page, ++sequence);
});

test('four live prefetches admit no fifth queue and excess activation uses fresh HTTP', async ({ page }) => {
  // Given: five actual viewport opportunities and four event-held HTTP responses.
  await installObserver(page);
  const release = gate();
  const four = gate();
  const completed = gate();
  const paths = new Set<string>();
  let finishes = 0;
  await page.route('**/prefetch/public-bound-*', async (route) => {
    if (route.request().headers().accept !== navigationMedia) return route.continue();
    paths.add(new URL(route.request().url()).pathname);
    if (paths.size === 4) four.resolve();
    await release.promise;
    try { await route.continue(); }
    finally { if (++finishes === 4) completed.resolve(); }
  });
  try {
    await page.goto('/admin/qr?prefetchBounds=true', { waitUntil: 'domcontentloaded' });
    await four.promise;
    await acknowledge(page, 1);
    expect(paths.size).toBe(4);
    const skipped = [1, 2, 3, 4, 5].find((entry) => !paths.has(`/prefetch/public-bound-${entry}`));
    if (skipped === undefined) throw new Error('Excess opportunity was not skipped');
    // When: those four settle, then the previously skipped Link is activated explicitly.
    release.resolve(); await completed.promise;
    await page.context().addCookies([{
      name: 'session', value: 'cache-test', url: new URL('/', page.url()).href,
    }]);
    const path = `/prefetch/public-bound-${skipped}`;
    const approval = page.waitForResponse((reply) => new URL(reply.url()).pathname === path
      && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
    const selected = await watchText(page, '#page-slot', `Prefetch public-bound-${skipped}`);
    await page.getByRole('link', { name: `Viewport bound ${skipped}`, exact: true }).evaluate((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing Link');
      anchor.click();
    });
    const fresh = await approval;
    expect(fresh.status()).toBe(200);
    expect(fresh.headers()['x-reliability-session-cookie']).toBe('present');
    expect(fresh.headers()['x-fluo-navigation-prefetch']).toBeUndefined();
    await settled(page, selected);
    // Then: the fifth was not a queued anonymous request; this is its first real GET.
    expect(paths.size).toBe(5);
    await acknowledge(page, 2);
  } finally {
    release.resolve(); four.resolve(); completed.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
