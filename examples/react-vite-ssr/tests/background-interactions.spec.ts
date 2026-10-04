import { expect, test, type Page } from '@playwright/test';

async function connected(page: Page) {
  await page.locator('form[data-enhanced]').first().evaluate((form) => {
    if (form.getAttribute('data-enhanced') === 'true') return;
    return new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (form.getAttribute('data-enhanced') !== 'true') return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Provider did not connect')); }, 10_000);
      observer.observe(form, { attributes: true });
    });
  });
}
async function watch(page: Page, id: string, expected: string) {
  await page.evaluate(({ id, expected }) => {
    const element = document.querySelector(`[data-form-state="${id}"]`);
    if (element === null) throw new Error('Missing operation output');
    Reflect.set(window, `__background_${id}`, new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(`[data-form-state="${id}"]`)?.textContent?.includes(expected)) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`Missing ${id} ${expected}`)); }, 10_000);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }));
  }, { id, expected });
}
async function arrived(page: Page, id: string) {
  await page.evaluate((id) => Reflect.get(window, `__background_${id}`), id);
}
async function arm(page: Page, key: string, phase: 'handler' | 'commit', fail = false) {
  expect((await page.request.post('/__background/arm', { data: { key, phase, fail } })).ok()).toBe(true);
}
async function release(page: Page, keys: readonly string[]) {
  expect((await page.request.post('/__background/release', { data: { keys } })).ok()).toBe(true);
}
const started = (page: Page, key: string) => page.request.get(`/__background/started?key=${encodeURIComponent(key)}`);
const cleaned = (page: Page, key: string) => page.request.get(`/__background/cleaned?key=${encodeURIComponent(key)}`);
async function open(page: Page) {
  await page.goto('/catalog/login');
  await page.goto('/catalog/background#queue');
  await connected(page);
}
async function shellAck(page: Page): Promise<string> {
  await page.getByLabel('Resource acknowledgement').evaluate((element) => {
    Reflect.set(window, '__backgroundAck', new Promise<string>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (!element.textContent?.endsWith(':ack')) return;
        observer.disconnect(); clearTimeout(timeout); resolve(element.textContent);
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Resource did not acknowledge')); }, 10_000);
      observer.observe(element, { childList: true, subtree: true, characterData: true });
    }));
  });
  await page.getByRole('button', { name: 'Probe shell resource', exact: true }).click();
  return page.evaluate(() => Reflect.get(window, '__backgroundAck'));
}

test('real held searches complete out of order while an independent widget and shell remain usable', async ({ page, browser, baseURL }) => {
  // Given: the actual datasource, listener, shell resource and request/body barriers.
  await open(page);
  const initial = await page.evaluate(() => ({ url: location.href, history: history.length, title: document.title }));
  const resource = await shellAck(page);
  const oldKey = 'GET:/catalog/background/search:Blue';
  const widgetKey = 'GET:/catalog/background/search:Gold';
  await arm(page, oldKey, 'handler');
  await arm(page, widgetKey, 'handler');
  const oldStarted = started(page, oldKey);
  const widgetStarted = started(page, widgetKey);
  const oldCleaned = cleaned(page, oldKey);
  const widgetCleaned = cleaned(page, widgetKey);
  const search = page.getByRole('form', { name: 'song-search', exact: true });
  const widget = page.getByRole('form', { name: 'song-widget', exact: true });
  await search.getByRole('textbox').fill('Blue');
  await search.getByRole('button', { name: 'Search songs' }).click();
  await oldStarted;
  await widget.getByRole('textbox').fill('Gold');
  await widget.getByRole('button', { name: 'Search songs' }).click();
  await widgetStarted;
  // When: a new explicit search completes before both held requests.
  await watch(page, 'song-search', 'read');
  await search.getByRole('textbox').fill('Green');
  await search.getByRole('button', { name: 'Search songs' }).click();
  await arrived(page, 'song-search');
  expect(await page.locator('[data-search-result="song-search"]').textContent()).toBe('Green song');
  expect(await page.locator('[data-form-state="song-widget"]').textContent()).toBe('pending');
  await watch(page, 'song-widget', 'read');
  await release(page, [oldKey, widgetKey]);
  await Promise.all([oldCleaned, widgetCleaned, arrived(page, 'song-widget')]);
  // Then: late results cannot replace the latest search, URL, head or operational shell.
  expect(await page.locator('[data-search-result="song-search"]').textContent()).toBe('Green song');
  expect(await page.locator('[data-search-result="song-widget"]').textContent()).toBe('Gold song');
  expect(await page.evaluate(() => ({ url: location.href, history: history.length, title: document.title }))).toEqual(initial);
  expect((await shellAck(page)).split(':')[0]).toBe(resource.split(':')[0]);
  await page.screenshot({ path: test.info().outputPath('background-desktop.png'), fullPage: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 },
    storageState: await page.context().storageState() });
  try {
    const small = await mobile.newPage();
    await small.goto(`${baseURL}/catalog/background#queue`);
    await connected(small);
    for (const [id, query] of [['song-search', 'Green'], ['song-widget', 'Gold']] as const) {
      await watch(small, id, 'read');
      const form = small.getByRole('form', { name: id, exact: true });
      await form.getByRole('textbox').fill(query);
      await form.getByRole('button', { name: 'Search songs' }).click();
      await arrived(small, id);
    }
    await shellAck(small);
    expect(await small.getByRole('heading', { name: 'Background catalog and jukebox', exact: true }).count()).toBe(1);
    await small.getByRole('heading', { name: 'Background catalog and jukebox', exact: true })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await small.screenshot({ path: test.info().outputPath('background-mobile.png') });
    await small.getByRole('button', { name: 'Notify logout', exact: true }).scrollIntoViewIfNeeded();
    await small.screenshot({ path: test.info().outputPath('background-mobile-controls.png') });
  } finally { await mobile.close(); }
});

test('two held row POSTs keep independent outcomes and confirm writes without history navigation', async ({ page }) => {
  // Given: two actual row mutations are held after persistence; one will lose its acknowledgement.
  await open(page);
  const initial = await page.evaluate(() => ({ url: location.href, history: history.length, title: document.title }));
  const resource = await shellAck(page);
  const keys = ['POST:/catalog/background/queue/blue:blue', 'POST:/catalog/background/queue/green:green'];
  await arm(page, keys[0] ?? '', 'commit');
  await arm(page, keys[1] ?? '', 'commit', true);
  const signals = keys.map((key) => started(page, key));
  const cleanup = keys.map((key) => cleaned(page, key));
  await page.getByRole('form', { name: 'queue-blue' }).getByRole('button').first().click();
  await page.getByRole('form', { name: 'queue-green' }).getByRole('button').first().click();
  await Promise.all(signals);
  expect(await page.locator('[data-form-state="queue-blue"]').textContent()).toBe('pending');
  expect(await page.locator('[data-form-state="queue-green"]').textContent()).toBe('pending');
  // When: the server releases both outcomes independently.
  await watch(page, 'queue-blue', 'saved read:complete');
  await watch(page, 'queue-green', 'uncertain');
  await release(page, keys);
  await Promise.all([arrived(page, 'queue-blue'), arrived(page, 'queue-green'), ...cleanup]);
  // Then: confirmed persistence, uncertain persistence and fresh HTTP read are distinct.
  const ack: unknown = JSON.parse(await page.locator('[data-operation-ack="queue-blue"]').textContent() ?? '{}');
  expect(ack).toMatchObject({ sku: 'blue', revision: expect.any(Number) });
  expect(await page.locator('[data-operation-ack="queue-green"]').textContent()).toBe('');
  expect(await page.evaluate(() => ({ url: location.href, history: history.length, title: document.title }))).toEqual(initial);
  expect((await shellAck(page)).split(':')[0]).toBe(resource.split(':')[0]);
});

test('actual page unmount settles its held row without reviving an old route or replaying POST', async ({ page }) => {
  // Given: a dispatched write is held after persistence, before acknowledgement.
  await open(page);
  const key = 'POST:/catalog/background/queue/gold:gold';
  await arm(page, key, 'commit');
  const requestStarted = started(page, key);
  const requestCleaned = cleaned(page, key);
  const posts: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
  await page.getByRole('form', { name: 'queue-gold' }).getByRole('button').first().click();
  await requestStarted;
  // When: a newer user navigation approves and actually unmounts the owner.
  const approval = page.waitForResponse((response) => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/catalog'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await page.getByRole('link', { name: 'Product list', exact: true }).click();
  await approval;
  await page.getByRole('heading', { name: 'Catalog', exact: true }).evaluate((element) => element.textContent);
  await release(page, [key]);
  await requestCleaned;
  // Then: no old-page resurrection or mutation replay follows the late acknowledgement.
  expect(new URL(page.url()).pathname).toBe('/catalog');
  expect(posts.filter((path) => path === '/catalog/background/queue/gold')).toHaveLength(1);
  expect(await page.locator('[data-form-state="queue-gold"]').count()).toBe(0);
});

test('native GET search and POST 303 GET queue remain usable without JavaScript', async ({ browser, baseURL }) => {
  // Given: the same actual page with JavaScript disabled.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/catalog/login`);
    await page.goto(`${baseURL}/catalog/background`);
    // When: ordinary controls submit GET and POST without enhancement.
    const search = page.getByRole('form', { name: 'song-search', exact: true });
    await search.getByRole('textbox').fill('Blue');
    const read = page.waitForRequest((request) => request.method() === 'GET'
      && new URL(request.url()).pathname === '/catalog/background/search');
    await search.getByRole('button', { name: 'Search songs' }).click();
    expect(new URL((await read).url()).searchParams.get('q')).toBe('Blue');
    const post = page.waitForResponse((response) => response.request().method() === 'POST');
    const document = page.waitForRequest((request) => request.method() === 'GET'
      && new URL(request.url()).pathname === '/catalog/background');
    await page.getByRole('form', { name: 'queue-blue' }).getByRole('button').first().click();
    // Then: the existing native HTTP path, not JSON acknowledgement, owns navigation.
    expect((await post).status()).toBe(303);
    await document;
    expect(new URL(page.url()).pathname).toBe('/catalog/background');
  } finally { await context.close(); }
});


test('a held shell widget survives approved tagged push replace back forward and explicit refresh', async ({ page }) => {
  // Given: only tagged entries created by this router, not an untagged document boundary.
  await open(page);
  const resource = await shellAck(page);
  const key = 'GET:/catalog/background/search:Gold';
  await arm(page, key, 'handler');
  const requestStarted = started(page, key);
  const requestCleaned = cleaned(page, key);
  const widget = page.getByRole('form', { name: 'song-widget', exact: true });
  await widget.getByRole('textbox').fill('Gold');
  await widget.getByRole('button', { name: 'Search songs' }).click();
  await requestStarted;
  const watchRoute = async () => {
    await page.evaluate(() => {
      const previous = location.pathname;
      Reflect.set(window, '__taggedBackgroundRoute', new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          if (location.pathname === previous) return;
          const reflected = [...document.querySelectorAll('p')].some((element) =>
            element.textContent?.includes('Current path: ' + location.pathname)
            || element.getAttribute('aria-label') === 'Current route' && element.textContent?.startsWith(location.pathname));
          if (!reflected) return;
          observer.disconnect(); clearTimeout(timeout); resolve();
        });
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Tagged route did not approve')); }, 10_000);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }));
    });
  };
  const routeApproved = () => page.evaluate(() => {
    const signal: unknown = Reflect.get(window, '__taggedBackgroundRoute');
    if (!(signal instanceof Promise)) throw new Error('Unexpected document boundary');
    return signal;
  });
  // When: push, replace, Back and Forward approve while the same shell read stays held.
  await watchRoute();
  await page.getByRole('link', { name: 'Product list', exact: true }).click();
  await routeApproved();
  await watchRoute();
  await page.getByRole('button', { name: /^Replace/u }).click();
  await routeApproved();
  const approvedPath = new URL(page.url()).pathname;
  await watchRoute(); await page.goBack(); await routeApproved();
  await watchRoute(); await page.goForward(); await routeApproved();
  await page.evaluate(() => {
    Reflect.set(window, '__backgroundRefresh', new Promise<void>((resolve, reject) => {
      let began = false;
      const observer = new MutationObserver(() => {
        const text = [...document.querySelectorAll('p')].find((element) =>
          element.textContent?.startsWith('Navigation:') || element.getAttribute('aria-label') === 'Navigation status')?.textContent ?? '';
        if (text.includes('refreshing')) began = true;
        if (!began || !text.includes('complete')) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Refresh did not approve')); }, 10_000);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }));
  });
  await page.getByRole('button', { name: /^Refresh(?: current page)?$/u }).click();
  await page.evaluate(() => Reflect.get(window, '__backgroundRefresh'));
  expect(await page.locator('[data-form-state="song-widget"]').textContent()).toBe('pending');
  await watch(page, 'song-widget', 'read'); await release(page, [key]);
  await Promise.all([requestCleaned, arrived(page, 'song-widget')]);
  // Then: the old read updates only its surviving owner, not history, page identity or approved route.
  expect(await page.locator('[data-search-result="song-widget"]').textContent()).toBe('Gold song');
  expect(new URL(page.url()).pathname).toBe(approvedPath);
  expect((await shellAck(page)).split(':')[0]).toBe(resource.split(':')[0]);
});


test('two successful row writes acknowledge in reverse order and coalesce one latest page approval', async ({ page }) => {
  // Given: two independent real POSTs commit but their response acknowledgements are held.
  await open(page);
  const before = await page.evaluate(() => ({ url: location.href, history: history.length, title: document.title }));
  const resource = await shellAck(page);
  const blueWasQueued = await page.locator('[data-queued="blue"]').textContent();
  const greenWasQueued = await page.locator('[data-queued="green"]').textContent();
  const keys = ['POST:/catalog/background/queue/blue:blue', 'POST:/catalog/background/queue/green:green'];
  await arm(page, keys[0] ?? '', 'commit');
  await arm(page, keys[1] ?? '', 'commit');
  const starts = keys.map((key) => started(page, key));
  const cleanup = keys.map((key) => cleaned(page, key));
  let pageReads = 0;
  let posts = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.startsWith('/catalog/background/queue/')) posts++;
    if (request.method() === 'GET' && url.pathname === '/catalog/background'
      && request.headers().accept?.includes('react-navigation') === true) pageReads++;
  });
  await page.getByRole('form', { name: 'queue-blue' }).getByRole('button').first().click();
  await starts[0];
  await page.getByRole('form', { name: 'queue-green' }).getByRole('button').first().click();
  await starts[1];
  // When: the newer commit acknowledges first; the older held write remains independent.
  await watch(page, 'queue-green', 'saved read:pending');
  await release(page, [keys[1] ?? '']);
  await arrived(page, 'queue-green');
  expect(await page.locator('[data-form-state="queue-blue"]').textContent()).toBe('pending');
  expect(pageReads).toBe(0);
  await watch(page, 'queue-green', 'saved read:complete');
  await watch(page, 'queue-blue', 'saved read:complete');
  await release(page, [keys[0] ?? '']);
  await Promise.all([arrived(page, 'queue-green'), arrived(page, 'queue-blue'), ...cleanup]);
  // Then: both confirmations share one freshest read, not N serial requests or a replayed write.
  expect(pageReads).toBe(1);
  expect(posts).toBe(2);
  const blue: unknown = JSON.parse(await page.locator('[data-operation-ack="queue-blue"]').textContent() ?? '{}');
  const green: unknown = JSON.parse(await page.locator('[data-operation-ack="queue-green"]').textContent() ?? '{}');
  expect(blue).toMatchObject({ sku: 'blue', revision: expect.any(Number) });
  expect(green).toMatchObject({ sku: 'green', revision: expect.any(Number) });
  expect(await page.locator('[data-queued="blue"]').textContent()).not.toBe(blueWasQueued);
  expect(await page.locator('[data-queued="green"]').textContent()).not.toBe(greenWasQueued);
  expect(await page.evaluate(() => ({ url: location.href, history: history.length, title: document.title }))).toEqual(before);
  expect((await shellAck(page)).split(':')[0]).toBe(resource.split(':')[0]);
});


test('a live shell widget survives page approval while the departing page row does not', async ({ page }) => {
  // Given: an actual held GET belongs to the persistent shell, not the catalog page.
  await open(page);
  const resource = await shellAck(page);
  const key = 'GET:/catalog/background/search:Gold';
  await arm(page, key, 'handler');
  const requestStarted = started(page, key);
  const requestCleaned = cleaned(page, key);
  const widget = page.getByRole('form', { name: 'song-widget', exact: true });
  await widget.getByRole('textbox').fill('Gold');
  await widget.getByRole('button', { name: 'Search songs' }).click();
  await requestStarted;
  // When: a newer page navigation approves but keeps the same shell owner.
  const approval = page.waitForResponse((response) => new URL(response.url()).pathname === '/catalog'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await page.getByRole('link', { name: 'Product list', exact: true }).click();
  await approval;
  await page.getByRole('heading', { name: 'Catalog', exact: true }).evaluate((element) => element.textContent);
  expect(await page.locator('[data-form-state="song-widget"]').textContent()).toBe('pending');
  await watch(page, 'song-widget', 'read');
  await release(page, [key]);
  await Promise.all([requestCleaned, arrived(page, 'song-widget')]);
  // Then: the widget completes independently without restoring its old page or changing shell identity.
  expect(await page.locator('[data-search-result="song-widget"]').textContent()).toBe('Gold song');
  expect(new URL(page.url()).pathname).toBe('/catalog');
  expect((await shellAck(page)).split(':')[0]).toBe(resource.split(':')[0]);
});

test('logout closes the real shell ports and revokes held background results before late acknowledgements', async ({ page }) => {
  // Given: real resources and two held HTTP operations share the old provider session.
  await page.addInitScript(() => {
    const closed = new Set<MessagePort>();
    const close = MessagePort.prototype.close;
    MessagePort.prototype.close = function () { closed.add(this); close.call(this); };
    document.addEventListener('fluo-resource', (event) => {
      const detail: unknown = Reflect.get(event, 'detail');
      if (typeof detail !== 'object' || detail === null || Reflect.get(detail, 'phase') !== 'cleanup') return;
      const ports: unknown = Reflect.get(detail, 'ports');
      Reflect.set(window, '__backgroundPortsClosed', Array.isArray(ports) && ports.every((port) => closed.has(port)));
    });
  });
  await open(page);
  await shellAck(page);
  const keys = ['GET:/catalog/background/search:Blue', 'POST:/catalog/background/queue/gold:gold'];
  await arm(page, keys[0] ?? '', 'handler');
  await arm(page, keys[1] ?? '', 'commit');
  const starts = keys.map((key) => started(page, key));
  const cleanup = keys.map((key) => cleaned(page, key));
  await page.getByRole('form', { name: 'song-search', exact: true }).getByRole('textbox').fill('Blue');
  await page.getByRole('form', { name: 'song-search', exact: true }).getByRole('button', { name: 'Search songs' }).click();
  await page.getByRole('form', { name: 'queue-gold' }).getByRole('button').first().click();
  await Promise.all(starts);
  await page.evaluate(() => {
    Reflect.set(window, '__backgroundLogout', new Promise<void>((resolve, reject) => {
      const element = document.querySelector('[data-session-state]');
      if (element === null) throw new Error('Missing session state');
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-session-state]')?.textContent?.includes('signed-out')) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Logout did not finish')); }, 10_000);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }));
  });
  // When: the app explicitly notifies logout before either acknowledgement can arrive.
  await page.getByRole('button', { name: 'Notify logout', exact: true }).click();
  await page.evaluate(() => Reflect.get(window, '__backgroundLogout'));
  await release(page, keys);
  await Promise.all(cleanup);
  // Then: actual port close, cleared widget and removed acknowledgements survive the late responses.
  expect(await page.evaluate(() => Reflect.get(window, '__backgroundPortsClosed'))).toBe(true);
  expect(await page.locator('[data-operation-ack="queue-gold"]').count()).toBe(0);
  expect(await page.locator('[data-search-result="song-search"]').count()).toBe(0);
  expect(await page.locator('[data-session-state]').textContent()).toContain('signed-out');
  expect(await page.getByRole('button', { name: 'Probe shell resource', exact: true }).count()).toBe(0);
});
