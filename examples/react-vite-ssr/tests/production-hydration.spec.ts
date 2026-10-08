import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __softNavigationDocument?: string;
  }
}

async function subscribeToResourceAck(page: Page, sequence: number): Promise<void> {
  await page.evaluate((expectedSequence) => {
    const output = document.querySelector('output[aria-label="Resource acknowledgement"]');
    if (output === null) throw new Error('The resource acknowledgement output is missing.');
    Reflect.set(window, '__resourceAck', new Promise<string>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (output.textContent?.includes(`:${expectedSequence}:ack`)) {
          observer.disconnect();
          window.clearTimeout(deadline);
          resolve(output.textContent);
        }
      });
      const deadline = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Resource acknowledgement ${expectedSequence} did not arrive.`));
      }, 10_000);
      observer.observe(output, { characterData: true, childList: true, subtree: true });
    }));
  }, sequence);
}

test('hydrates streamed production HTML with generated Vite assets', async ({ page }) => {
  const browserDiagnostics: string[] = [];
  const assetResponses = new Map<string, number>();

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    browserDiagnostics.push(`pageerror: ${error.message}`);
  });
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/assets/')) {
      assetResponses.set(pathname, response.status());
    }
  });

  const response = await page.goto('/products/sku-42?preview=true#details', { waitUntil: 'networkidle' });
  if (response === null) {
    throw new TypeError('The production page did not return a navigation response.');
  }

  const html = await response.text();
  const bootstrapPaths = await page.locator('script[type="module"][src]').evaluateAll((scripts) =>
    scripts.map((script) => new URL(script.getAttribute('src') ?? '', document.baseURI).pathname),
  );
  const stylesheetPaths = await page.locator('link[data-vite-style][href]').evaluateAll((links) =>
    links.map((link) => new URL(link.getAttribute('href') ?? '', document.baseURI).pathname),
  );

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(html).toContain('Loading recommendations');
  expect(html).toContain('Recommended for sku-42');
  expect(html).toContain('Current URL: /products/sku-42?preview=true');
  expect(html).toContain('property="og:title"');
  expect(html).not.toContain('Current URL: /products/sku-42?preview=true#details');
  expect(bootstrapPaths).toEqual(expect.arrayContaining([expect.stringMatching(/^\/assets\/entry-client-[a-zA-Z0-9_-]+\.js$/u)]));
  expect(stylesheetPaths).toHaveLength(1);

  for (const pathname of [...bootstrapPaths, ...stylesheetPaths]) {
    expect(assetResponses.get(pathname), `${pathname} should be served from the production asset route`).toBe(200);
  }

  expect([...assetResponses.keys()].some((pathname) => pathname.includes('/recommendations-'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Catalog item sku-42' })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Product sku-42');
  await expect(page.getByRole('region', { name: 'Recommendations' })).toHaveText('Recommended for sku-42');
  await expect(page.getByText('Current URL: /products/sku-42?preview=true#details')).toBeVisible();
  await expect(page.getByText('Current hash: #details')).toBeVisible();
  await expect(page.locator('[data-react-identifier]')).toHaveAttribute('id', /fluo-react-vite-/u);
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__softNavigationDocument = 'original'; });

  await page.getByRole('link', { name: 'Open sku-84' }).click();
  await expect(page).toHaveURL(/\/products\/sku-84\?preview=false$/u);
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-84' })).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('original');
  await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible();
  await expect(page.getByText('Current path: /products/sku-84')).toBeVisible();
  await expect(page.getByText('Current preview: false')).toBeVisible();

  await page.getByRole('button', { name: 'Push sku-126' }).click();
  await expect(page).toHaveURL(/\/products\/sku-126\?preview=true$/u);
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-126' })).toBeVisible();
  await expect(page.getByText('Current path: /products/sku-126')).toBeVisible();
  expect(browserDiagnostics).toEqual([]);
});

test('traverses admin QR and songs with a preserved shell, reset page state and focus', async ({ page }) => {
  // Given: a server-rendered admin page with shell and page-local state.
  const browserDiagnostics: string[] = [];
  page.on('pageerror', (error) => browserDiagnostics.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserDiagnostics.push(message.text());
    }
  });
  await page.goto('/admin/qr');
  await expect(page).toHaveTitle('Admin QR');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'QR access');
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.getByText('Current route sku: unset')).toBeVisible();
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await page.getByRole('button', { name: 'Page count: 0' }).click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();
  await page.evaluate(() => { window.__softNavigationDocument = 'admin-shell'; });
  const navigationResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2',
  );

  // When: the ordinary Link moves to songs, then browser history visits QR and forward again.
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  const response = await navigationResponse;

  // Then: every view is HTTP-confirmed while shell identity and focus policy remain observable.
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/vnd\.fluo\.react-navigation\+json;\s*v="2"; charset=utf-8$/u);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toMatchObject({
    version: 2,
    buildId: expect.any(String),
    url: '/admin/songs',
    params: {},
    destination: { module: './navigation-admin.ts' },
  });
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await expect(page).toHaveTitle('Admin songs');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Songs catalog');
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('link[data-vite-style]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  await expect(page.getByText('Current path: /admin/songs')).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('admin-shell');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/admin\/qr$/u);
  await expect(page).toHaveTitle('Admin QR');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'QR access');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page count: 0' })).toBeVisible();
  await expect(page.getByText('Current path: /admin/qr')).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('admin-shell');
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  await expect(page).toHaveTitle('Admin songs');
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  expect(browserDiagnostics).toEqual([]);
});

test('keeps the approved page and head while a later HTTP destination is pending', async ({ page }) => {
  // Given: the exact negotiated request is held before it can approve a new page.
  await page.goto('/admin/qr');
  const initialTitle = await page.title();
  let release = () => {};
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/products/sku-84?preview=false', async (route) => {
    if (route.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2') {
      await deferred;
    }
    await route.continue();
  });
  const requestStarted = page.waitForRequest((request) =>
    new URL(request.url()).pathname === '/products/sku-84'
    && request.headers().accept === 'application/vnd.fluo.react-navigation+json;v=2',
  { timeout: 10_000 });
  const click = page.getByRole('link', { name: 'Open sku-84' }).click();
  try {
    await requestStarted;

    // When: the destination has not yet received HTTP approval.
    // Then: pending is announced outside the still interactive approved page slot.
    await expect(page.locator('[aria-live="polite"]:not([data-form-state])')).toHaveText('Loading page');
    await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/qr$/u);
    expect(await page.title()).toBe(initialTitle);
    await page.getByRole('button', { name: 'Page count: 0' }).click();
    await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();
  } finally {
    release();
  }
  await click;
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item sku-84' })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]:not([data-form-state])')).toHaveText('Page ready');
  await expect(page).toHaveTitle('Catalog item sku-84');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Product sku-84');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Product sku-84');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', '/products/sku-84?preview=false');
});

test('removes an approved page stylesheet without removing the global stylesheet', async ({ page }) => {
  // Given: the approved songs payload adds a page-owned stylesheet alongside the global Vite CSS.
  await page.route('**/assets/route-only.css', (route) =>
    route.fulfill({ body: 'body { color: #123456; }', contentType: 'text/css' }));
  await page.route('**/admin/songs', async (route) => {
    if (route.request().headers().accept !== 'application/vnd.fluo.react-navigation+json;v=2') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || !('metadata' in payload)
      || typeof payload.metadata !== 'object' || payload.metadata === null) {
      throw new Error('The HTTP-approved page has no metadata.');
    }
    await route.fulfill({ response, contentType: 'application/vnd.fluo.react-navigation+json;v=2', body: JSON.stringify({
      ...payload,
      metadata: { ...payload.metadata, links: [{ rel: 'stylesheet', href: '/assets/route-only.css' }] },
    }) });
  });
  await page.goto('/admin/qr');
  await page.evaluate(() => { document.documentElement.dataset.stylingIdentity = 'retained'; });

  // When: a page-owned stylesheet is approved and the next destination no longer owns it.
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  expect(await page.evaluate(() => document.documentElement.dataset.stylingIdentity)).toBe('retained');
  await expect(page.locator('[aria-live="polite"]:not([data-form-state])')).toHaveText('Page ready');
  await expect(page.locator('link[rel="stylesheet"][href="/assets/route-only.css"]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Open admin QR' }).click();

  // Then: the stale page-owned link is removed, but the global Vite stylesheet survives.
  await expect(page.locator('link[rel="stylesheet"][href="/assets/route-only.css"]')).toHaveCount(0);
  await expect(page.locator('link[data-vite-style]')).toHaveCount(1);
});

test('ignores a superseded approval without replacing the newer route or head', async ({ page }) => {
  // Given: an older destination is held pending and a newer admin page can still respond.
  await page.goto('/admin/qr');
  let release = () => {};
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/products/sku-84?preview=false', async (route) => {
    if (route.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2') {
      await deferred;
    }
    try {
      await route.continue();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('intercepted request')) throw error;
    }
  });
  const oldRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === '/products/sku-84'
    && request.headers().accept === 'application/vnd.fluo.react-navigation+json;v=2',
  { timeout: 10_000 });
  const firstClick = page.getByRole('link', { name: 'Open sku-84' }).click();
  try {
    await oldRequest;
    const newerApproval = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/admin/songs'
      && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');

    // When: another destination is approved before the earlier network result is released.
    await page.getByRole('link', { name: 'Open admin songs' }).click();
    expect((await newerApproval).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/songs$/u);
  } finally {
    release();
  }
  await firstClick;

  // Then: only the latest approved page, params and head identify the visible route.
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page).toHaveTitle('Admin songs');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Songs catalog');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.getByText('Current route sku: unset')).toBeVisible();
});

test('resets an approved render failure without reloading the document or the shell resource', async ({ page }) => {
  // Given: a live MessageChannel shell resource and one destination that throws during React rendering.
  const errors: string[] = [];
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  await page.goto('/admin/qr');
  const probe = page.getByRole('button', { name: 'Probe shell resource' });
  await subscribeToResourceAck(page, 1);
  await probe.click();
  const acknowledgement = page.getByLabel('Resource acknowledgement');
  await page.evaluate(() => Reflect.get(window, '__resourceAck'));
  const initialIdentity = await page.locator('[data-resource-id]').getAttribute('data-resource-id');
  const firstAck = await acknowledgement.textContent();
  await page.evaluate(() => { window.__softNavigationDocument = 'retained'; });
  let approvalCount = 0;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/products/render-error'
      && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2') {
      approvalCount++;
    }
  });
  const approved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/render-error'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');

  // When: the HTTP-approved component fails to render, then the user resets that page boundary.
  await page.getByRole('link', { name: 'Open throwing destination' }).click();
  expect((await approved).status()).toBe(200);
  await expect(page.getByRole('alert', { name: 'Page rendering failed' })).toBeVisible();
  await expect(page).toHaveURL(/\/products\/render-error$/u);
  await expect(page).toHaveTitle('Catalog item render-error');
  await page.evaluate(() => { Reflect.set(window, '__allowRenderRetry', true); });
  await page.getByRole('button', { name: 'Try rendering this page again' }).focus();
  await page.keyboard.press('Enter');

  // Then: the approved route is restored locally, and the same resource acknowledges a new operation.
  await expect(page.getByRole('heading', { name: 'Browser destination: Catalog item render-error' })).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('retained');
  expect(await page.locator('[data-resource-id]').getAttribute('data-resource-id')).toBe(initialIdentity);
  await subscribeToResourceAck(page, 2);
  await probe.click();
  expect(await page.evaluate(() => Reflect.get(window, '__resourceAck'))).toBe(`${initialIdentity}:2:ack`);
  expect(await acknowledgement.textContent()).not.toBe(firstAck);
  expect(approvalCount).toBe(1);
  expect(errors).toEqual([]);
  expect(diagnostics.some((entry) => entry.includes('React destination render failed'))).toBe(true);
});

test('shows a separate usable view if the application error view throws', async ({ page }) => {
  // Given: the approved destination and the application's error-view override both throw.
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  await page.goto('/admin/qr');
  const approved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/render-error'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');

  // When: the destination is approved with the throwing error-view fixture.
  await page.getByRole('link', { name: 'Open throwing error view' }).click();
  expect((await approved).status()).toBe(200);

  // Then: the outer diagnostic surface offers a native exit while shell controls still operate.
  await expect(page.getByRole('alert', { name: 'Page error view failed' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open this page as a document' })).toHaveAttribute(
    'href', /\/products\/render-error\?throwFallback=true$/u,
  );
  await page.getByRole('button', { name: 'Count: 0' }).click();
  await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible();
  expect(diagnostics.some((entry) => entry.includes('React destination error view failed'))).toBe(true);
});

test('applies pathname, query, fragment and traversal focus and scroll defaults', async ({ page }) => {
  // Given: an approved document with enough height for distinct scroll positions.
  await page.goto('/products/sku-42?preview=true');
  await page.evaluate(() => {
    document.body.style.minHeight = '3000px';
    window.scrollTo(0, 400);
  });
  expect(await page.evaluate(() => window.scrollY)).toBe(400);
  const queryApproval = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/sku-42'
    && new URL(response.url()).search === '?preview=false'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');

  // When: query-only approval completes without an automatic click-induced scroll.
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/products/sku-42?preview=false"]')?.click());
  expect((await queryApproval).status()).toBe(200);
  await expect(page).toHaveURL(/\/products\/sku-42\?preview=false$/u);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  expect(await page.evaluate(() => window.scrollY)).toBe(400);

  // When: fragment navigation activates an eligible target without an HTTP request.
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('nav a[href="#details"]')?.click();
  });
  await expect(page).toHaveURL(/\/products\/sku-42\?preview=false#details$/u);
  await expect(page.getByText('Current hash: #details')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('details');
  expect(await page.evaluate(() => window.scrollY)).not.toBe(400);

  // When: history returns from the fragment and then a pathname change is approved.
  await page.goBack();
  await expect(page).toHaveURL(/\/products\/sku-42\?preview=false$/u);
  await expect(page.getByText('Current hash: unset')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  expect(await page.evaluate(() => window.scrollY)).toBe(400);
  const pathnameApproval = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/admin/songs"]')?.click());
  expect((await pathnameApproval).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/songs$/u);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('preserves page-local state when a fragment focuses a target inside the approved slot', async ({ page }) => {
  // Given: the approved page owns both its counter and the fragment target.
  await page.goto('/admin/qr');
  await page.getByRole('button', { name: 'Page count: 0' }).click();
  await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();
  await page.evaluate(() => { window.__softNavigationDocument = 'fragment-document'; });

  // When: same-document fragment navigation focuses the page-local target.
  await page.getByRole('link', { name: 'Jump to admin details' }).click();

  // Then: the approved slot is not remounted and the shell/document remain in place.
  await expect(page).toHaveURL(/\/admin\/qr#admin-details$/u);
  await expect(page.locator('#page-slot #admin-details')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('fragment-document');
});

test('keeps the shell resource operational after a malformed fragment', async ({ page }) => {
  // Given: an interactive approved page and a live shell MessageChannel.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/qr');
  const probe = page.getByRole('button', { name: 'Probe shell resource' });
  const identity = await page.locator('[data-resource-id]').getAttribute('data-resource-id');
  await page.getByRole('button', { name: 'Page count: 0' }).click();
  await page.evaluate(() => { window.__softNavigationDocument = 'malformed-document'; });

  // When: the hydrated same-document Link activates an invalid percent escape.
  await page.getByRole('link', { name: 'Open malformed fragment' }).click();

  // Then: page, shell, and a new resource operation survive without an effect error.
  await expect(page).toHaveURL(/\/admin\/qr#%$/u);
  await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();
  await subscribeToResourceAck(page, 1);
  await probe.click();
  expect(await page.evaluate(() => Reflect.get(window, '__resourceAck'))).toBe(`${identity}:1:ack`);
  expect(await page.locator('[data-resource-id]').getAttribute('data-resource-id')).toBe(identity);
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBe('malformed-document');
  expect(errors).toEqual([]);
});

test('keeps the official page slot and navigation controls reachable at mobile width', async ({ page }) => {
  // Given: a narrow real Chrome viewport rendering a production document.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin/qr');

  // When: a destination is approved in the same mobile document.
  await page.getByRole('link', { name: 'Open admin songs' }).click();

  // Then: the approved page, polite status and shell controls remain reachable without horizontal clipping.
  await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]:not([data-form-state])')).toHaveText('Page ready');
  await expect(page.getByRole('button', { name: 'Probe shell resource' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  if (process.env.FLUO_REACT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.FLUO_REACT_SCREENSHOT_DIR}/example-mobile.png` });
  }
});

test('keeps native new tabs and full-document fallback on server rejection', async ({ page, context }) => {
  // Given: a hydrated page with a native anchor and a request rejected by HTTP validation.
  await page.goto('/admin/qr');
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  const originalUrl = page.url();
  const originalDocument = await page.evaluateHandle(() => document);
  const tabPromise = context.waitForEvent('page', { timeout: 10_000 });
  await page.getByRole('link', { name: 'Open admin songs' }).click({ modifiers: ['ControlOrMeta'] });
  const tab = await tabPromise;
  await expect(tab.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  expect(await originalDocument.evaluate((documentBefore) => documentBefore === document)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  await tab.close();
  await originalDocument.dispose();
  await page.evaluate(() => { window.__softNavigationDocument = 'before-fallback'; });
  const rejected = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/x'
    && response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2');

  // When: the regular Link requests a DTO-invalid destination.
  await page.getByRole('link', { name: 'Open invalid product' }).click();
  expect((await rejected).status()).toBe(400);

  // Then: no unapproved soft transition occurs; HTTP receives a document request.
  await expect(page).toHaveURL(/\/products\/x\?preview=maybe$/u);
  expect(await page.evaluate(() => window.__softNavigationDocument)).toBeUndefined();
});

test('submits the native mutation form without client JavaScript', async ({ baseURL, browser }) => {
  // Given: an authorized browser context with JavaScript disabled.
  if (baseURL === undefined) {
    throw new TypeError('The browser test requires a configured base URL.');
  }

  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-example-user': 'catalog-editor' },
    javaScriptEnabled: false,
  });
  const page = await context.newPage();

  try {
    const admin = await page.goto('/admin/qr');
    expect(admin?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
    await page.getByRole('link', { name: 'Open admin songs' }).click();
    await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
    const initial = await page.goto('/products/sku-42?preview=true');
    expect(initial?.headers()['content-type']).toContain('text/html');
    await page.getByLabel('Product name').fill('No-script catalog item');
    const mutationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/products/sku-42',
    );

    // When: the browser submits the rendered HTML form.
    await page.getByRole('button', { name: 'Save product' }).click();
    const mutationResponse = await mutationResponsePromise;

    // Then: the POST redirects through the normal GET route in the no-JavaScript context.
    expect(mutationResponse.status()).toBe(303);
    expect(mutationResponse.headers().location).toBe('/products/sku-42?updated=true');
    await expect(page).toHaveURL(/\/products\/sku-42\?updated=true$/u);
    await expect(page.getByText('Saved product: No-script catalog item')).toBeVisible();
  } finally {
    await context.close();
  }
});
