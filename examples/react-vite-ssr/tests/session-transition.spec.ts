import { expect, test, type Page } from '@playwright/test';

const screenshotId = Date.now();

test('legacy plain children leave through a real unauthorized document after revocation', async ({ page }) => {
  await page.goto('/catalog/session');
  const origin = new URL(page.url()).origin;
  expect((await page.request.post('/catalog/session/login', {
    form: { identity: 'a', csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
  })).status()).toBe(303);
  await page.goto('/catalog/session/protected?legacySession=1');
  await connected(page);
  expect(await page.locator('[data-legacy-protected]').textContent()).toBe('Legacy protected a');
  expect((await page.request.post('/catalog/session/logout', {
    form: { csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
  })).status()).toBe(303);
  const read = page.waitForResponse((response) => response.status() === 401
    && response.request().headers().accept?.includes('react-navigation') === true);
  const document = page.waitForResponse((response) => response.status() === 401
    && response.request().resourceType() === 'document');
  const rendered = page.waitForEvent('domcontentloaded');
  await page.getByRole('button', { name: 'Session refresh', exact: true }).click();
  await read;
  await document;
  await rendered;
  expect(await page.locator('[data-legacy-protected]').count()).toBe(0);
  console.log(JSON.stringify({ observation: 'legacy-auth-document-exit', read: 401, document: 401, protectedChildren: 0 }));
});

test('configured POST auth policy refresh performs one fresh GET and never replays POST', async ({ page }) => {
  await page.goto('/catalog/session');
  const origin = new URL(page.url()).origin;
  expect((await page.request.post('/catalog/session/login', {
    form: { identity: 'a', csrf: 'catalog-demo-token' }, headers: { Origin: origin }, maxRedirects: 0,
  })).status()).toBe(303);
  await page.goto('/catalog/session/protected?authRefresh=1');
  await connected(page);
  const posts: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.locator('form[aria-label="Session login"] input[name="csrf"]').evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing csrf control');
    input.value = 'invalid-token';
  });
  await watch(page, '[data-session-state]', 'approved');
  const post = page.waitForResponse((response) => response.request().method() === 'POST');
  const read = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await page.getByRole('button', { name: 'Login B', exact: true }).click();
  expect((await post).status()).toBe(403);
  expect((await read).status()).toBe(200);
  await settled(page);
  // The read commit, not a timer, proves current approval has returned.
  await expect(page.locator('[data-product="private-a"]')).toHaveText('Protected content a');
  expect(await page.locator('[data-session-state]').textContent()).toContain('approved');
  expect(posts).toHaveLength(1);
  console.log(JSON.stringify({ observation: 'configured-post-auth-refresh', post: 403, get: 200, posts: 1 }));
});

test('configured GET auth refresh dispatches a fresh read then settles signed out', async ({ page }) => {
  await page.goto('/catalog/session?authRefresh=1');
  await connected(page);
  await watch(page, '[data-session-state]', ':2:signed-out');
  const denied: number[] = [];
  const settledRead = page.waitForResponse((response) => {
    if (response.status() !== 401 || response.request().headers().accept?.includes('react-navigation') !== true) return false;
    denied.push(response.status());
    return denied.length === 2;
  });
  await page.getByRole('link', { name: 'Session soft page', exact: true }).click();
  await settledRead;
  await settled(page);
  await expect(page.locator('[data-session-url]')).toContainText('{}');
  expect(denied).toEqual([401, 401]);
  expect(await page.locator('[data-product="private-a"]').count()).toBe(0);
  console.log(JSON.stringify({ observation: 'configured-get-auth-refresh', reads: denied, protectedContent: 0 }));
});
async function watch(page: Page, selector: string, text: string, key = '__sessionSignal') {
  await page.evaluate(({ selector, text, key }) => {
    const element = document.querySelector(selector);
    if (element === null) throw new Error(`Missing ${selector}`);
    const signal = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (!element.textContent?.includes(text)) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`Missing state ${text}`)); }, 10_000);
      observer.observe(element, { subtree: true, characterData: true, childList: true });
    });
    Reflect.set(window, key, signal);
  }, { selector, text, key });
}
async function settled(page: Page, key = '__sessionSignal') {
  await page.evaluate((key) => Reflect.get(window, key), key);
}
async function connected(page: Page) {
  await page.locator('form[data-enhanced]').first().evaluate((form) => {
    if (form.getAttribute('data-enhanced') === 'true') return;
    return new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (form.getAttribute('data-enhanced') !== 'true') return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Provider not connected')); }, 10_000);
      observer.observe(form, { attributes: true, attributeFilter: ['data-enhanced'] });
    });
  });
}
async function login(page: Page, identity: 'a' | 'b') {
  await watch(page, '[data-session-state]', `demo:${identity}`);
  const read = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true
    && new URL(response.url()).pathname === '/catalog/session/protected');
  const post = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/session/login');
  await page.getByRole('button', { name: `Login ${identity.toUpperCase()}`, exact: true }).click();
  const acknowledgement = await post;
  console.log(JSON.stringify({ observation: 'session-login-ack', status: acknowledgement.status(), body: await acknowledgement.text() }));
  expect(acknowledgement.status()).toBe(200);
  expect((await read).status()).toBe(200);
  await settled(page);
  await expect(page.locator(`[data-product="private-${identity}"]`)).toHaveText(`Protected content ${identity}`);
}

test('revokes initial and soft protected pages, closes owned ports, and cancels held HTTP before release', async ({ page }) => {
  // Given: real two-session HTTP and an operational app-owned MessageChannel.
  const failures: string[] = [];
  const requests: { method: string; path: string }[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/catalog/session')) {
      requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    }
  });
  await page.addInitScript(() => {
    const events: { phase: string; id: string; ports: number }[] = [];
    const closed = new WeakSet<MessagePort>();
    const nativeClose = MessagePort.prototype.close;
    MessagePort.prototype.close = function () {
      Reflect.apply(nativeClose, this, []);
      closed.add(this);
    };
    Reflect.set(window, '__sessionResources', events);
    document.addEventListener('fluo-resource', (event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== 'object' || detail === null) return;
      const phase: unknown = Reflect.get(detail, 'phase');
      const id: unknown = Reflect.get(detail, 'id');
      const ports: unknown = Reflect.get(detail, 'ports');
      if (typeof phase === 'string' && typeof id === 'string' && Array.isArray(ports)) {
        const owned = ports.filter((port: unknown): port is MessagePort => port instanceof MessagePort);
        if (phase === 'cleanup' && owned.some((port) => !closed.has(port))) {
          throw new Error('Cleanup reported before closing an actual owned MessagePort');
        }
        events.push({ phase, id, ports: owned.length });
      }
    });
  });
  await page.goto('/catalog/session');
  await connected(page);
  await login(page, 'a');
  // A direct document proves initial SSR approval, not only a soft destination.
  await page.goto('/catalog/session/protected');
  await connected(page);
  requests.length = 0;
  const identity = await page.locator('[data-resource-id]').getAttribute('data-resource-id');
  await watch(page, '[aria-label="Resource acknowledgement"]', ':ack', '__resourceAck');
  await page.getByRole('button', { name: 'Probe shell resource', exact: true }).click();
  await settled(page, '__resourceAck');
  expect(await page.locator('[aria-label="Resource acknowledgement"]').textContent()).toContain(identity);
  await page.getByRole('textbox', { name: 'Protected draft' }).fill('Private A edit');
  await page.request.post('/__forms/arm', { data: { mode: 'hold-read' } });
  const started = page.request.get('/__forms/started');
  const cleaned = page.request.get('/__forms/cleaned');
  await page.evaluate(() => {
    Reflect.set(window, '__resourceCleanup', new Promise<void>((resolve, reject) => {
      const handler = (event: Event) => {
        if (!(event instanceof CustomEvent) || event.detail?.phase !== 'cleanup') return;
        document.removeEventListener('fluo-resource', handler); clearTimeout(timeout); resolve();
      };
      const timeout = setTimeout(() => {
        document.removeEventListener('fluo-resource', handler); reject(new Error('Owned resource did not close'));
      }, 10_000);
      document.addEventListener('fluo-resource', handler);
    }));
  });
  await page.evaluate(() => {
    Reflect.set(window, '__refreshCancelled', new Promise<void>((resolve, reject) => {
      const handler = (event: Event) => {
        if (!(event instanceof CustomEvent) || event.detail?.operation !== 'refresh' || event.detail.status !== 'cancelled') return;
        document.removeEventListener('session-operation', handler); clearTimeout(timeout); resolve();
      };
      const timeout = setTimeout(() => { document.removeEventListener('session-operation', handler); reject(new Error('Old refresh did not cancel')); }, 10_000);
      document.addEventListener('session-operation', handler);
    }));
  });
  await page.getByRole('button', { name: 'Session refresh', exact: true }).click();
  await started;
  // When: explicit logout runs while the actual HTTP body remains held.
  await watch(page, '[data-session-state]', 'signed-out');
  await page.getByRole('button', { name: 'Notify logout', exact: true }).click();
  await settled(page);
  await settled(page, '__refreshCancelled');
  await settled(page, '__resourceCleanup');
  // Then: protected SSR fallback/head/input disappear and exact owned ports are cleaned.
  expect(await page.locator('[data-product="private-a"]').count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Protected draft' }).count()).toBe(0);
  expect(await page.locator('head title').allTextContents()).not.toContain('Protected a');
  const resources: unknown = await page.evaluate(() => Reflect.get(window, '__sessionResources'));
  expect(resources).toEqual(expect.arrayContaining([{ phase: 'cleanup', id: identity, ports: 2 }]));
  await page.request.post('/__forms/release');
  await cleaned;
  await login(page, 'b');
  expect(await page.locator('[data-product="private-a"]').count()).toBe(0);
  expect(await page.locator('head title').allTextContents()).toContain('Protected b');
  const recoveredIdentity = await page.locator('[data-resource-id]').getAttribute('data-resource-id');
  expect(recoveredIdentity).not.toBe(identity);
  await watch(page, '[aria-label="Resource acknowledgement"]', ':ack', '__resourceNewAck');
  await page.getByRole('button', { name: 'Probe shell resource', exact: true }).click();
  await settled(page, '__resourceNewAck');
  expect(await page.locator('[aria-label="Resource acknowledgement"]').textContent()).toContain(recoveredIdentity);
  expect(await page.locator('[data-session-url]').textContent()).toContain('/catalog/session/protected');
  expect(requests.filter((request) => request.method === 'POST' && request.path === '/catalog/session/login')).toHaveLength(1);
  expect(failures).toEqual([]);
  console.log(JSON.stringify({ observation: 'session-held-http-revocation', resources, requests, staleProtectedContent: false }));
  expect(await page.locator('[aria-label="Session controls"]').count()).toBe(1);
  await page.screenshot({ path: `../../.omo/verification/issue-3875/session-desktop-${screenshotId}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(JSON.stringify({ observation: 'session-mobile-layout', metrics: await page.evaluate(() => ({
    width: window.innerWidth, scroll: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')].filter((element) =>
      element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8)
      .map((element) => ({ html: element.outerHTML.slice(0, 240),
        style: { width: getComputedStyle(element).width, minWidth: getComputedStyle(element).minWidth,
          padding: getComputedStyle(element).padding, margin: getComputedStyle(element).margin,
          display: getComputedStyle(element).display, position: getComputedStyle(element).position },
        parent: element.parentElement?.outerHTML.slice(0, 120),
      })),
  })) }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../../.omo/verification/issue-3875/session-mobile-${screenshotId}.png` });
});

test('403 stays forbidden and a confirmed permissions save is separate from its rejected GET', async ({ page }) => {
  // Given: an approved session with an enhanced permission-change POST.
  await page.goto('/catalog/session');
  await connected(page);
  await login(page, 'a');
  const posts: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
  await watch(page, '[data-session-state]', 'forbidden');
  const rejected = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  // When: HTTP confirms permissions changed, then refuses the fresh protected GET.
  await page.getByRole('button', { name: 'Revoke permissions', exact: true }).click();
  expect((await rejected).status()).toBe(403);
  await settled(page);
  // Then: identity is retained, protected content removed, and persistence remains saved.
  expect(await page.locator('[data-session-state]').textContent()).toContain('demo:a');
  await expect(page.locator('[data-permission-result]')).toHaveText('saved:error');
  expect(await page.locator('[data-product="private-a"]').count()).toBe(0);
  expect(posts).toHaveLength(1);
  console.log(JSON.stringify({ observation: 'session-permission-denial', posts: posts.length, identityRetained: true }));
});

test('anonymous 401 keeps approval and external HttpOnly logout is applied only on a fresh credentialed 401', async ({ page }) => {
  // Given: approved session A and a credential-omitted speculative request.
  await page.goto('/catalog/session');
  await connected(page);
  await login(page, 'a');
  const speculative = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.get('speculative') === '1');
  await page.getByRole('link', { name: 'Speculate protected', exact: true }).hover();
  const anonymous = await speculative;
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['x-fluo-navigation-prefetch']).toBeUndefined();
  expect(await page.locator('[data-session-state]').textContent()).toContain('demo:a');
  expect(await page.locator('[data-product="private-a"]').count()).toBe(1);
  await page.getByRole('textbox', { name: 'Protected draft' }).fill('Private A external change');
  // When: HTTP changes the shared HttpOnly cookie without a browser app notification.
  const logout = await page.request.post('/catalog/session/logout', {
    form: { csrf: 'catalog-demo-token' },
    headers: { Origin: new URL(page.url()).origin },
    maxRedirects: 0,
  });
  expect(logout.status()).toBe(303);
  expect(await page.locator('[data-product="private-a"]').count()).toBe(1);
  await watch(page, '[data-session-state]', 'signed-out');
  const fresh = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true
    && new URL(response.url()).search === '');
  await page.getByRole('button', { name: 'Session refresh', exact: true }).click();
  expect((await fresh).status()).toBe(401);
  await settled(page);
  // Then: fresh HTTP revokes protected content/head/input and a distinct login recovers.
  expect(await page.locator('[data-product="private-a"]').count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Protected draft' }).count()).toBe(0);
  expect(await page.locator('head title').allTextContents()).not.toContain('Protected a');
  await login(page, 'b');
  expect(await page.locator('[data-product="private-a"]').count()).toBe(0);
  console.log(JSON.stringify({
    observation: 'session-external-cookie-and-speculation',
    anonymous: 401, beforeFreshRead: 'approved-a', fresh: 401, recovered: 'b',
  }));
});
