import { expect, test, type Page } from '@playwright/test';
import { acknowledge, faultedQR, go, navigationMedia, saveRow } from './long-session-helpers';
import { installObserver, settled, watchText } from './long-session-observer';
import { resources } from './long-session-metrics';

async function open(page: Page) {
  await installObserver(page);
  expect((await page.request.get('/catalog/login')).ok()).toBe(true);
  await page.goto('/catalog/background', { waitUntil: 'domcontentloaded' });
  await acknowledge(page, 1);
}

test('a correctly framed incompatible build preserves the operational document and recovers by fresh approval', async ({ page }) => {
  await open(page);
  const before = await resources(page);
  await faultedQR(page, 'deploy', () => acknowledge(page, 2).then(() => {}));
  expect(await resources(page)).toMatchObject({
    document: before.document, id: before.id, actualInstanceRetained: true,
    cleanups: 0, mounts: 1, url: '/admin/qr',
  });
  await acknowledge(page, 3);
});

async function installImportGate(page: Page, key: '__reliabilityImport' | '__reliabilityPolicy') {
  await page.evaluate((key) => {
    let start: () => void = () => { throw new Error('Missing start'); };
    let release: () => void = () => { throw new Error('Missing release'); };
    let complete: () => void = () => { throw new Error('Missing completion'); };
    const started = new Promise<void>((resolve) => { start = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const completed = new Promise<void>((resolve) => { complete = resolve; });
    Reflect.set(window, '__ownershipGate', { started, completed, release });
    Reflect.set(window, key, {
      module: './navigation-admin.ts', fault: 'hold', started: start, release: released, completed: complete,
    });
  }, key);
}

async function gateSignal(page: Page, phase: 'started' | 'completed') {
  await page.evaluate(async (phase) => {
    const signal = Reflect.get(window, '__ownershipGate')[phase];
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([signal, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error(`Missing ${phase} seam event`)), 10_000);
      })]);
    } finally { clearTimeout(deadline); }
  }, phase);
}

async function releaseGate(page: Page) {
  await page.evaluate(() => Reflect.get(window, '__ownershipGate').release());
  await gateSignal(page, 'completed');
  await page.evaluate(() => Reflect.deleteProperty(window, '__ownershipGate'));
}

for (const seam of ['import', 'policy'] as const) {
  test(`obsolete ${seam} completion cannot replace fresh HTTP approval or initiate fallback`, async ({ page }) => {
    // Given: a real mapped importer or failure decision held at its existing seam.
    await open(page);
    const initial = await resources(page);
    await installImportGate(page, seam === 'import' ? '__reliabilityImport' : '__reliabilityPolicy');
    if (seam === 'policy') await page.route('**/admin/songs', (route) =>
      route.request().headers().accept === navigationMedia
        ? route.fulfill({ status: 503, body: 'Held policy outcome' }) : route.continue());
    await page.getByRole('link', { name: 'Open admin songs', exact: true }).click();
    await gateSignal(page, 'started');
    // When: a different actual HTTP approval supersedes the unfinished owner.
    await go(page, '/admin/qr');
    const approved = await resources(page);
    await releaseGate(page);
    const final = await resources(page);
    // Then: late importer/policy cannot replace URL, params, page, head or document.
    expect(final).toMatchObject({ document: initial.document, id: initial.id, url: '/admin/qr', title: 'Admin QR' });
    expect(final).toEqual(approved);
    await acknowledge(page, 2);
    await go(page, '/catalog/background');
    await saveRow(page, 'blue');
  });
}

test('a superseded partial HTTP body and invalid payload cannot restore their obsolete authority', async ({ page }) => {
  // Given: the real listener writes headers and a body prefix, then waits for release.
  await open(page);
  const initial = await resources(page);
  expect((await page.request.post('/__forms/arm', { data: { mode: 'hold-read' } })).ok()).toBe(true);
  const started = page.request.get('/__forms/started', { timeout: 10_000 });
  const cleaned = page.request.get('/__forms/cleaned', { timeout: 10_000 });
  const pending = await watchText(page, 'nav p', 'Navigation: refreshing');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await started; await settled(page, pending);
  // When: a fresh navigation unmounts the page before the old body is released.
  await go(page, '/admin/qr');
  expect((await page.request.post('/__forms/release')).ok()).toBe(true);
  await cleaned;
  // Then: the current HTTP-approved view and operational instance remain authoritative.
  expect(await resources(page)).toMatchObject({ document: initial.document, id: initial.id,
    url: '/admin/qr', title: 'Admin QR', actualInstanceRetained: true });
  await acknowledge(page, 2);
  await go(page, '/catalog/background');
  await saveRow(page, 'gold');
});

test('saved plus failed follow-up is recovered by GET only without a second POST', async ({ page }) => {
  // Given: the real guarded row POST may commit while its automatic read fails.
  await open(page);
  let posts = 0;
  const count = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/catalog/background/queue/blue') posts++;
  };
  page.on('request', count);
  await page.route('**/catalog/background', (route) =>
    route.request().headers().accept === navigationMedia
      ? route.fulfill({ status: 503, body: 'Follow-up unavailable' }) : route.continue());
  const saved = await watchText(page, '[data-form-state="queue-blue"]', 'saved read:error');
  const post = page.waitForResponse((reply) => reply.request().method() === 'POST'
    && new URL(reply.url()).pathname === '/catalog/background/queue/blue', { timeout: 10_000 });
  await page.getByRole('form', { name: 'queue-blue', exact: true }).getByRole('button').first().click();
  expect((await post).status()).toBe(200); await settled(page, saved);
  const acknowledgement = await page.locator('[data-operation-ack="queue-blue"]').textContent();
  // When: the user requests only the failed read.
  await page.unroute('**/catalog/background');
  const complete = await watchText(page, '[data-form-state="queue-blue"]', 'saved read:complete');
  const read = page.waitForResponse((reply) => reply.request().headers().accept === navigationMedia
    && new URL(reply.url()).pathname === '/catalog/background', { timeout: 10_000 });
  await page.getByRole('form', { name: 'queue-blue', exact: true })
    .getByRole('button', { name: 'Retry read only', exact: true }).click();
  expect((await read).status()).toBe(200); await settled(page, complete);
  // Then: the saved acknowledgement and actual fresh queue coexist, without POST replay.
  expect(posts).toBe(1);
  expect(await page.locator('[data-operation-ack="queue-blue"]').textContent()).toBe(acknowledgement);
  page.off('request', count);
});

test('invalid current payload uses the native document boundary and explicit reload creates a new resource', async ({ page }) => {
  // Given: invalid current payload must not be reclassified as a preservable transient failure.
  await open(page);
  const before = await resources(page);
  await page.route('**/admin/qr', (route) => route.request().headers().accept === navigationMedia
    ? route.fulfill({ status: 200, contentType: navigationMedia, body: '{"version":99}' }) : route.continue());
  const document = page.waitForRequest((request) => request.resourceType() === 'document'
    && new URL(request.url()).pathname === '/admin/qr', { timeout: 10_000 });
  const loaded = page.waitForEvent('domcontentloaded', { timeout: 10_000 });
  // When: the ordinary Link receives an invalid current approval.
  await page.getByRole('link', { name: 'Open admin QR', exact: true }).click();
  await document; await loaded;
  await acknowledge(page, 1);
  expect((await resources(page)).document).not.toBe(before.document);
  expect((await resources(page)).id).not.toBe(before.id);
  // Then: an explicit user reload is a separate document/resource boundary too.
  const updated = await resources(page);
  const reload = page.waitForEvent('domcontentloaded', { timeout: 10_000 });
  await page.evaluate(() => window.location.reload());
  await reload; await acknowledge(page, 1);
  expect((await resources(page)).document).not.toBe(updated.document);
});
