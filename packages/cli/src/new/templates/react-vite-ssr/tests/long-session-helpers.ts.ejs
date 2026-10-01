import { expect, type Page } from '@playwright/test';
import { acknowledge, settled, watchText } from './long-session-observer';

export const navigationMedia = 'application/vnd.fluo.react-navigation+json;v=2';
export const faults = ['network', 'server-error', 'slow', 'payload', 'import', 'render', 'deploy'] as const;
export type Fault = typeof faults[number];

/** Fixed schedule, reproducible without wall-clock randomness. */
export function faultAt(seed: number, cycle: number): Fault {
  const fault = faults[(seed + cycle) % faults.length];
  if (fault === undefined) throw new Error('Invalid fault schedule');
  return fault;
}

export function gate() {
  let resolve: () => void = () => { throw new Error('Uninitialized barrier'); };
  const promise = new Promise<void>((done, reject) => {
    const deadline = setTimeout(() => reject(new Error('HTTP barrier timed out')), 30_000);
    resolve = () => { clearTimeout(deadline); done(); };
  });
  return { promise, resolve };
}

export async function navigation(page: Page, path: string, action: () => Promise<unknown>): Promise<void> {
  const signal = await watchText(page, 'nav p, header p, [aria-label="Current route"]', path);
  const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === path
    && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
  await action();
  const approved = await response;
  expect(approved.status()).toBe(200);
  const payload = await approved.json();
  await settled(page, signal);
  expect(new URL(page.url()).pathname).toBe(path);
  if (payload.metadata?.title !== undefined) expect(await page.title()).toBe(payload.metadata.title);
  if (process.env.FLUO_RELIABILITY_STARTER === '1') {
    expect(await page.getByLabel('Current route').textContent()).toContain(JSON.stringify(payload.params));
  } else {
    expect(await page.getByText(`Current route sku: ${payload.params.sku ?? 'unset'}`, { exact: true }).count()).toBe(1);
  }
}

export async function go(page: Page, path: string): Promise<void> {
  await navigation(page, path, () => page.locator(`a[href="${path}"]`).first().evaluate((anchor) => {
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing progressive anchor');
    anchor.click();
  }));
}

/** Slow HTTP and stale invalid payload are released by a real intercepted request event. */
export async function faultedQR(page: Page, fault: Fault, operation: () => Promise<void>): Promise<void> {
  if (fault === 'payload') {
    const previous = await page.evaluate(() => ({ path: location.pathname, title: document.title }));
    expect((await page.request.post('/__reliability/payload/arm')).ok()).toBe(true);
    const started = page.request.get('/__reliability/payload/started', { timeout: 10_000 });
    const cleaned = page.request.get('/__reliability/payload/cleaned', { timeout: 10_000 });
    try {
      const pending = await watchText(page, 'nav p, [aria-label="Navigation status"]', 'navigating');
      await page.locator('a[href="/admin/qr"]').first().evaluate((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing QR anchor');
        anchor.click();
      });
      await started; await settled(page, pending); await operation();
      const cancelled = page.waitForEvent('requestfailed', { predicate: (request) =>
        new URL(request.url()).pathname === '/admin/qr', timeout: 10_000 });
      const idle = await watchText(page, 'nav p, [aria-label="Navigation status"]', 'idle');
      await page.getByRole('button', { name: process.env.FLUO_RELIABILITY_STARTER === '1'
        ? 'Invalidate navigation' : 'Invalidate prefetched pages', exact: true }).click();
      await cancelled; await settled(page, idle);
      expect(await page.evaluate(() => ({ path: location.pathname, title: document.title }))).toEqual(previous);
    } finally { expect((await page.request.post('/__reliability/payload/release')).ok()).toBe(true); }
    await cleaned;
    await go(page, '/admin/qr');
    return;
  }
  if (fault === 'render') {
    await page.evaluate(() => Reflect.set(window, '__allowRenderRetry', false));
    const signal = await watchText(page, '[role="alert"]', 'This page could not be displayed.');
    const approved = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/products/render-error'
      && reply.request().headers().accept === navigationMedia, { timeout: 10_000 });
    await page.getByRole('link', { name: process.env.FLUO_RELIABILITY_STARTER === '1'
      ? 'Open throwing page' : 'Open throwing destination', exact: true }).click();
    expect((await approved).status()).toBe(200);
    await settled(page, signal);
    await operation();
    await page.evaluate(() => Reflect.set(window, '__allowRenderRetry', true));
    const reset = await watchText(page, '#page-slot', 'Catalog item render-error');
    await page.getByRole('button', { name: 'Try rendering this page again', exact: true }).click();
    await settled(page, reset);
    await go(page, '/admin/qr');
    return;
  }
  const release = gate();
  const complete = gate();
  let used = false;
  if (fault === 'deploy') expect((await page.request.post('/__reliability/deploy/arm')).ok()).toBe(true);
  if (fault === 'import') await page.evaluate(() => {
    Reflect.set(window, '__reliabilityImport', {
      module: Reflect.get(window, '__longStarter') === true ? './page-admin.tsx' : './navigation-admin.ts', fault: 'reject',
    });
  });
  const intercept = async (route: import('@playwright/test').Route) => {
    if (route.request().headers().accept !== navigationMedia || used) return route.continue();
    used = true;
    try {
      switch (fault) {
        case 'network': await route.abort('internetdisconnected'); break;
        case 'server-error': await route.fulfill({ status: 503, body: 'Injected unavailable' }); break;
        case 'slow': await release.promise; await route.continue(); break;
        case 'import': await route.continue(); break;
        case 'deploy': await route.continue(); break;
        default: throw new Error(`Unexpected fault: ${fault satisfies never}`);
      }
    } finally { complete.resolve(); }
  };
  await page.route('**/admin/qr', intercept);
  try {
    if (fault === 'slow') {
      const previous = await page.evaluate(() => ({ path: location.pathname, title: document.title }));
      const pending = await watchText(page, 'nav p, [aria-label="Navigation status"]', 'navigating');
      const started = page.waitForRequest((request) => new URL(request.url()).pathname === '/admin/qr'
        && request.headers().accept === navigationMedia, { timeout: 10_000 });
      await page.locator('a[href="/admin/qr"]').first().evaluate((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing QR anchor');
        anchor.click();
      });
      await started;
      await settled(page, pending);
      expect(await page.evaluate(() => ({ path: location.pathname, title: document.title }))).toEqual(previous);
      await operation();
      const approved = await watchText(page, 'nav p, [aria-label="Current route"]', '/admin/qr');
      release.resolve(); await complete.promise; await settled(page, approved);
    } else {
      const reason = fault === 'import' ? 'import-failure' : fault === 'deploy' ? 'incompatible-build' : fault;
      const failed = await watchText(page, '[role="alert"]', `Navigation failed: ${reason}`);
      await page.locator('a[href="/admin/qr"]').first().evaluate((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Missing QR anchor');
        anchor.click();
      });
      await complete.promise; await settled(page, failed); await operation();
      await page.unroute('**/admin/qr', intercept);
      await navigation(page, '/admin/qr', () => page.getByRole('button', { name: 'Retry navigation', exact: true }).click());
    }
  } finally {
    release.resolve();
    complete.resolve();
    await page.unroute('**/admin/qr', intercept);
  }
}

export async function search(page: Page, id: string, query: string): Promise<void> {
  const signal = await watchText(page, `[data-search-result="${id}"]`, `${query} song`);
  const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === '/catalog/background/search'
    && new URL(reply.url()).searchParams.get('q') === query, { timeout: 10_000 });
  const form = page.getByRole('form', { name: id, exact: true });
  await form.getByRole('textbox').fill(query);
  await form.getByRole('button', { name: 'Search songs', exact: true }).click();
  expect((await response).status()).toBe(200);
  await settled(page, signal);
  expect(await page.locator(`[data-form-state="${id}"]`).textContent()).toBe('read');
}

export async function saveRow(page: Page, sku: string): Promise<void> {
  const before = await page.locator(`[data-queued="${sku}"]`).textContent();
  const signal = await watchText(page, `[data-form-state="queue-${sku}"]`, 'saved read:complete');
  const response = page.waitForResponse((reply) => reply.request().method() === 'POST'
    && new URL(reply.url()).pathname === `/catalog/background/queue/${sku}`, { timeout: 10_000 });
  await page.getByRole('form', { name: `queue-${sku}`, exact: true }).getByRole('button').first().click();
  expect((await response).status()).toBe(200);
  await settled(page, signal);
  expect(JSON.parse(await page.locator(`[data-operation-ack="queue-${sku}"]`).textContent() ?? 'null'))
    .toMatchObject({ sku, revision: expect.any(Number) });
  expect(await page.locator(`[data-queued="${sku}"]`).textContent()).not.toBe(before);
}

export { acknowledge };
