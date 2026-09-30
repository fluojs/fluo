import { expect, test, type Page } from '@playwright/test';
import type { CatalogObservation } from '../src/catalog';

async function observeState(page: Page, id: string, expected: string) {
  await page.evaluate(({ id, expected }) => {
    const output = document.querySelector(`[data-form-state="${id}"]`);
    if (output === null) throw new Error('Missing form outcome output');
    Reflect.set(window, '__formOutcome', new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (!output.textContent?.includes(expected)) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      };
      const observer = new MutationObserver(finish);
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Form outcome did not arrive')); }, 10_000);
      observer.observe(output, { subtree: true, childList: true, characterData: true });
    }));
  }, { id, expected });
}
async function outcome(page: Page) {
  await page.evaluate(() => Reflect.get(window, '__formOutcome'));
}
async function hydrated(page: Page) {
  await page.locator('form[data-enhanced]').first().evaluate((form) => {
    if (form.getAttribute('data-enhanced') === 'true') return;
    return new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (form.getAttribute('data-enhanced') !== 'true') return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Provider did not connect')); }, 10_000);
      observer.observe(form, { attributes: true, attributeFilter: ['data-enhanced'] });
    });
  });
}
type ControlState = {
  requests: number;
  commits: number;
  events: CatalogObservation[];
  bodies: { scope: string; accept?: string; contentType?: string; bodyKeys: string[]; name?: string; tag?: string[]; intent?: string; csrfPresent: boolean }[];
  uploads: { contentType: string; bytes: string }[];
};
async function state(page: Page): Promise<ControlState> {
  return (await page.request.get('/__forms/state')).json();
}
async function arm(page: Page, mode: string): Promise<{ requests: number; commits: number }> {
  return (await page.request.post('/__forms/arm', { data: { mode } })).json();
}
async function editor(page: Page) {
  await page.goto('/catalog/login');
  await page.goto('/catalog/sku-42');
  await hydrated(page);
}

test('real HTTP JSON compatibility records native submission classification', async ({ request, baseURL }) => {
  const response = await request.post('/catalog/create', {
    form: { display_name: 'Listener product', csrf: 'catalog-demo-token', intent: 'save' },
    headers: { Accept: 'application/json', Cookie: 'editor=yes; csrf=catalog-demo-token', Origin: baseURL ?? '' },
    maxRedirects: 0,
  });
  console.log(JSON.stringify({ observation: 'listener-create', status: response.status(),
    ...(response.status() >= 400 ? { classification: await response.json() } : {}) }));
  expect(response.status()).toBe(303);
});

for (const mode of ['disabled', 'bootstrap-blocked'] as const) {
  test(`native production CRUD with ${mode}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: mode !== 'disabled' });
    if (mode === 'bootstrap-blocked') {
      await context.route('**/assets/entry-client-*.js', (route) => route.abort());
    }
    const page = await context.newPage();
    const posts: string[] = [];
    page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
    try {
      await page.goto(`${baseURL}/catalog/login`);
      const create = page.getByRole('form', { name: 'Create product', exact: true });
      await create.getByRole('textbox').fill(`Native ${mode}`);
      const created = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/catalog/create');
      const detail = page.waitForRequest((request) => request.method() === 'GET' && /\/catalog\/item-\d+$/u.test(new URL(request.url()).pathname));
      await create.getByRole('button', { name: 'Create product', exact: true }).click();
      expect((await created).status()).toBe(303);
      await detail;
      const sku = new URL(page.url()).pathname.split('/').at(-1);
      if (sku === undefined) throw new Error('Missing created SKU');
      await expect(page.locator(`[data-product="${sku}"]`)).toHaveText(`Native ${mode}`);
      const save = page.getByRole('form', { name: 'Save product', exact: true });
      // Deliberately bypass browser constraints to exercise actual HTTP DTO rejection.
      await save.getByRole('textbox').fill('x');
      await save.evaluate((form) => { form.setAttribute('novalidate', ''); });
      const rejected = page.waitForResponse((response) => response.request().method() === 'POST');
      await save.getByRole('button', { name: 'Save product', exact: true }).click();
      expect((await rejected).status()).toBe(400);
      await expect(page.getByRole('textbox')).toHaveValue('x');
      await page.getByRole('textbox').fill(`Corrected ${mode}`);
      const corrected = page.waitForResponse((response) => response.request().method() === 'POST');
      const correctedRead = page.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).pathname === `/catalog/${sku}`);
      await page.getByRole('button', { name: 'Save product', exact: true }).click();
      expect((await corrected).status()).toBe(303);
      await correctedRead;
      await expect(page.locator(`[data-product="${sku}"]`)).toHaveText(`Corrected ${mode}`);
      const beforeReload = posts.length;
      await page.reload();
      expect(posts.length).toBe(beforeReload);
      const deleted = page.waitForResponse((response) => response.request().method() === 'POST');
      const listRead = page.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).pathname === '/catalog');
      await page.getByRole('button', { name: 'Delete product', exact: true }).click();
      expect((await deleted).status()).toBe(303);
      await listRead;
      await expect(page.locator(`[data-product="${sku}"]`)).toHaveCount(0);
      console.log(JSON.stringify({ observation: 'native-crud', mode, sku, posts: posts.length, postReplayOnRefresh: false }));
    } finally {
      await context.close();
    }
  });
}

test('enhanced production save keeps unrelated input and recovers a failed read without POST replay', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(error.message));
  await page.goto('/catalog/login');
  await page.goto('/catalog/sku-42');
  await hydrated(page);
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  const independent = page.getByRole('form', { name: 'Independent product', exact: true }).getByRole('textbox');
  await independent.fill('Keep this draft');
  await page.evaluate(() => Reflect.set(window, '__formDocument', document));
  const save = page.getByRole('form', { name: 'Save product', exact: true });
  await save.getByRole('textbox').fill('x');
  await save.evaluate((form) => form.setAttribute('novalidate', ''));
  await observeState(page, 'edit-sku-42', 'validation');
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST');
  await save.getByRole('button', { name: 'Save product', exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await outcome(page);
  await expect(save.getByRole('textbox')).toHaveValue('x');
  await expect(save.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  await expect(independent).toHaveValue('Keep this draft');
  await save.getByRole('textbox').fill('Enhanced product');
  let failedRead = true;
  await page.route('**/catalog/sku-42', async (route) => {
    if (route.request().method() === 'GET' && failedRead) {
      failedRead = false;
      await route.fulfill({ status: 503, body: 'Read unavailable' });
    } else await route.continue();
  });
  const posts: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
  await observeState(page, 'edit-sku-42', 'saved read:error');
  await save.getByRole('button', { name: 'Save product', exact: true }).click();
  await outcome(page);
  await independent.focus();
  const read = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await save.getByRole('button', { name: 'Retry read only' }).click();
  expect((await read).status()).toBe(200);
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Enhanced product');
  await expect(independent).toHaveValue('Keep this draft');
  expect(posts.length).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__formDocument') === document)).toBe(true);
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
  expect(diagnostics).toEqual([]);
  console.log(JSON.stringify({ observation: 'saved-read-recovery', mutationCount: posts.length, draftRetained: true, shellRetained: true }));
});

test('cookie authorization and CSRF reject enhanced mutations without save acknowledgement', async ({ page }) => {
  await page.goto('/catalog/sku-42');
  await hydrated(page);
  const save = page.getByRole('form', { name: 'Save product', exact: true });
  await save.getByRole('textbox').fill('Must not persist');
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await observeState(page, 'edit-sku-42', 'auth:unauthorized');
  const auth = page.waitForResponse((response) => response.request().method() === 'POST');
  await save.getByRole('button', { name: 'Save product', exact: true }).click();
  expect((await auth).status()).toBe(401);
  await outcome(page);
  await page.goto('/catalog/login');
  await page.goto('/catalog/sku-42');
  await hydrated(page);
  const guarded = page.getByRole('form', { name: 'Save product', exact: true });
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await guarded.locator('[name="csrf"]').evaluate((input) => {
    if (input instanceof HTMLInputElement) input.value = 'tampered';
  });
  await observeState(page, 'edit-sku-42', 'auth:forbidden');
  const csrf = page.waitForResponse((response) => response.request().method() === 'POST');
  await guarded.getByRole('button', { name: 'Save product', exact: true }).click();
  expect((await csrf).status()).toBe(403);
  await outcome(page);
  console.log(JSON.stringify({ observation: 'auth-csrf', unauthorized: 401, tamperedToken: 403 }));
});

test('actual listener barrier skips click Enter and requestSubmit while another form validates', async ({ page }) => {
  await editor(page);
  const first = page.getByRole('form', { name: 'Save product', exact: true });
  await first.getByRole('textbox').fill('Held first product');
  const before = await arm(page, 'hold-before');
  const started = page.request.get('/__forms/started');
  const post = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/sku-42/update');
  await first.getByRole('button', { name: 'Save product', exact: true }).click();
  await started;
  await observeState(page, 'edit-sku-42', 'skipped:1');
  await first.getByRole('button', { name: 'Save product', exact: true }).click();
  await outcome(page);
  await observeState(page, 'edit-sku-42', 'skipped:2');
  await first.getByRole('textbox').press('Enter');
  await outcome(page);
  await observeState(page, 'edit-sku-42', 'skipped:3');
  await first.evaluate((form) => {
    if (form instanceof HTMLFormElement) form.requestSubmit(form.querySelector('button[type="submit"]'));
  });
  await outcome(page);
  const other = page.getByRole('form', { name: 'Independent product', exact: true });
  await other.getByRole('textbox').fill('x');
  await other.evaluate((form) => form.setAttribute('novalidate', ''));
  await observeState(page, 'independent-product', 'validation');
  const invalid = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/create');
  await other.getByRole('button', { name: 'Independent product', exact: true }).click();
  expect((await invalid).status()).toBe(400);
  await outcome(page);
  await other.getByRole('textbox').focus();
  await page.request.post('/__forms/release');
  expect((await post).status()).toBe(200);
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Held first product');
  await expect(other.getByRole('textbox')).toHaveValue('x');
  await expect(other.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  await expect(other.getByRole('textbox')).toBeFocused();
  const after = await state(page);
  expect(after.requests - before.requests).toBe(2);
  expect(after.commits - before.commits).toBe(1);
  const read = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await first.getByRole('textbox').fill('Explicit new input');
  await first.getByRole('button', { name: 'Save product', exact: true }).click();
  await read;
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Explicit new input');
  const final = await state(page);
  expect(final.requests - before.requests).toBe(3);
  expect(final.commits - before.commits).toBe(2);
  console.log(JSON.stringify({ observation: 'duplicate-server-barrier', posts: 3, commits: 2, skipped: 3, otherErrorInputFocusRetained: true }));
});

for (const mode of ['before-drop', 'before503', 'drop-after', 'after500', 'bad-media', 'bad-schema', 'bad-version', 'unsafe', 'redirect303', 'redirect307'] as const) {
  test(`real transport failure ${mode} never repeats a POST`, async ({ page }) => {
    await editor(page);
    const form = page.getByRole('form', { name: 'Save product', exact: true });
    const name = `Transport ${mode}`;
    await form.getByRole('textbox').fill(name);
    const before = await arm(page, mode);
    const requests: string[] = [];
    const failed: unknown[] = [];
    page.on('requestfailed', (request) => failed.push({ url: request.url(), failure: request.failure() }));
    const abortedRedirect = mode === 'redirect307' ? page.waitForEvent('requestfailed', {
      predicate: (request) => new URL(request.url()).pathname === '/catalog/login',
    }) : null;
    page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/catalog/')) requests.push(request.url()); });
    const started = mode === 'before-drop' || mode === 'drop-after' ? page.request.get('/__forms/started') : null;
    const headers = started === null ? null : page.waitForResponse((response) => response.request().method() === 'POST');
    await observeState(page, 'edit-sku-42', 'uncertain');
    await form.getByRole('button', { name: 'Save product', exact: true }).click();
    if (started !== null) {
      await started;
      await headers;
      await page.request.post('/__forms/release');
    }
    await outcome(page);
    await expect(form.getByRole('textbox')).toHaveValue(name);
    const after = await state(page);
    console.log(JSON.stringify({ observation: 'transport-request-chain', mode, requests, failed,
      listenerRequests: after.requests - before.requests, commits: after.commits - before.commits }));
    if (abortedRedirect !== null) {
      // Chrome reports the blocked manual 307 redirect in DevTools; it never reaches onRequest.
      expect((await abortedRedirect).failure()?.errorText).toBe('net::ERR_ABORTED');
      expect(requests.map((url) => new URL(url).pathname)).toEqual(['/catalog/sku-42/update', '/catalog/login']);
    } else {
      expect(requests.length).toBe(1);
    }
    expect(after.requests - before.requests).toBe(1);
    const committed = mode !== 'before-drop' && mode !== 'before503';
    expect(after.commits - before.commits).toBe(committed ? 1 : 0);
    const actual = await page.request.get('/catalog/sku-42', {
      headers: { Accept: 'application/vnd.fluo.react-navigation+json;v=2' },
    });
    expect(actual.status()).toBe(200);
    const data = await actual.json();
    expect(data.destination.props.products[0].name === name).toBe(committed);
    expect(new URL(page.url()).pathname).toBe('/catalog/sku-42');
    console.log(JSON.stringify({ observation: 'uncertain-persistence', mode, posts: 1, committed, nativeReplay: false }));
  });
}

test('late response body and cancelled commit cannot overwrite an explicit later save', async ({ page }) => {
  await editor(page);
  const form = page.getByRole('form', { name: 'Save product', exact: true });
  await form.getByRole('textbox').fill('Late acknowledged body');
  const before = await arm(page, 'body-late');
  const started = page.request.get('/__forms/started');
  const headers = page.waitForResponse((response) => response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  await started;
  expect((await headers).status()).toBe(200);
  await observeState(page, 'edit-sku-42', 'uncertain:cancelled');
  await form.getByRole('button', { name: 'Cancel waiting' }).click();
  await outcome(page);
  expect((await state(page)).commits - before.commits).toBe(1);
  await form.getByRole('textbox').fill('Later explicit save');
  const newerRead = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  await newerRead;
  await page.request.post('/__forms/release');
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Later explicit save');
  const after = await state(page);
  expect(after.commits - before.commits).toBe(2);
  expect(after.requests - before.requests).toBe(2);
  console.log(JSON.stringify({ observation: 'late-body-cancel', confirmedCommits: 2, explicitPosts: 2, latestPreserved: true }));
});

for (const mode of ['incompatible', 'import'] as const) {
  test(`confirmed save survives ${mode} follow-up and GET-only recovery`, async ({ page }) => {
    await editor(page);
    const form = page.getByRole('form', { name: 'Save product', exact: true });
    await form.getByRole('textbox').fill(`Read recovery ${mode}`);
    const before = await arm(page, mode);
    await observeState(page, 'edit-sku-42', 'saved read:error');
    await form.getByRole('button', { name: 'Save product', exact: true }).click();
    await outcome(page);
    const read = page.waitForResponse((response) => response.request().method() === 'GET'
      && response.request().headers().accept?.includes('react-navigation') === true);
    await form.getByRole('button', { name: 'Retry read only' }).click();
    await read;
    await expect(page.locator('[data-product="sku-42"]')).toHaveText(`Read recovery ${mode}`);
    const after = await state(page);
    expect(after.requests - before.requests).toBe(1);
    expect(after.commits - before.commits).toBe(1);
    console.log(JSON.stringify({ observation: 'read-only-recovery', mode, posts: 1, commits: 1 }));
  });
}

test('listener records native and negotiated DTO pipeline identity and actual successful controls', async ({ page, baseURL }) => {
  await editor(page);
  const before = await state(page);
  const native = await page.request.post('/catalog/sku-42/update', {
    form: { display_name: 'Native scope identity', csrf: 'catalog-demo-token', intent: 'save' },
    headers: { Origin: baseURL ?? '', Accept: 'text/html' }, maxRedirects: 0,
  });
  expect(native.status()).toBe(303);
  const form = page.getByRole('form', { name: 'Save product', exact: true });
  await form.getByRole('textbox').fill('Negotiated scope identity');
  await form.evaluate((node) => {
    for (const value of ['alpha', 'beta']) {
      const control = document.createElement('input'); control.name = 'tag'; control.value = value; node.append(control);
    }
    const ignored = document.createElement('input'); ignored.name = 'ignored'; ignored.value = 'not sent'; ignored.disabled = true; node.append(ignored);
  });
  const enhanced = page.waitForResponse((response) => response.request().method() === 'POST');
  const read = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await form.evaluate((node) => {
    if (node instanceof HTMLFormElement) node.requestSubmit(node.querySelector('button[type="submit"]'));
  });
  expect((await enhanced).status()).toBe(200);
  await read;
  const after = await state(page);
  const commits = after.events.filter((event) => event.phase === 'commit').slice(before.commits);
  expect(commits).toHaveLength(2);
  expect(new Set(commits.map((event) => event.scope)).size).toBe(2);
  for (const commit of commits) {
    const phases = after.events.filter((event) => event.scope === commit.scope);
    expect(phases.map((event) => event.phase)).toEqual(['middleware', 'guard', 'interceptor', 'dto', 'handler', 'commit', 'cleanup']);
    expect(phases.find((event) => event.phase === 'dto')?.dto).toBe(true);
    expect(phases.find((event) => event.phase === 'guard')?.matched).toBe('update');
  }
  const body = after.bodies.find((value) => value.scope === commits[1]?.scope);
  expect(body?.tag).toEqual(['alpha', 'beta']);
  expect(body?.intent).toBe('save');
  expect(body?.csrfPresent).toBe(true);
  expect(body?.bodyKeys).not.toContain('ignored');
  console.log(JSON.stringify({ observation: 'actual-http-pipeline', scopes: commits.map((value) => value.scope), body, cleanupExactlyOnce: true }));
});

test('native and enhanced listeners enforce missing expired and tampered credentials identically', async ({ page, baseURL }) => {
  await editor(page);
  const cases = [
    { status: 200, cookie: 'editor=yes; csrf=catalog-demo-token', origin: baseURL ?? '', csrf: 'catalog-demo-token' },
    { status: 401, cookie: '', origin: baseURL ?? '', csrf: 'catalog-demo-token' },
    { status: 401, cookie: 'editor=expired; csrf=catalog-demo-token', origin: baseURL ?? '', csrf: 'catalog-demo-token' },
    { status: 403, cookie: 'editor=yes; csrf=catalog-demo-token', origin: 'http://wrong.invalid', csrf: 'catalog-demo-token' },
    { status: 403, cookie: 'editor=yes; csrf=catalog-demo-token', origin: baseURL ?? '', csrf: '' },
    { status: 403, cookie: 'editor=yes; csrf=catalog-demo-token', origin: baseURL ?? '', csrf: 'tampered' },
  ];
  for (const entry of cases) {
    for (const enhanced of [false, true]) {
      const before = await state(page);
      const response = await page.request.post('/catalog/sku-42/update', {
        form: { display_name: 'Credential comparison', csrf: entry.csrf, intent: 'save' },
        headers: { Cookie: entry.cookie, Origin: entry.origin,
          Accept: enhanced ? 'application/vnd.fluo.form+json;v=1' : 'text/html' },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(entry.status === 200 && !enhanced ? 303 : entry.status);
      const after = await state(page);
      expect(after.commits - before.commits).toBe(entry.status === 200 ? 1 : 0);
      expect(after.events.slice(before.events.length).filter((event) => event.phase === 'guard')).toHaveLength(1);
      if (entry.status !== 200) {
        expect(after.events.slice(before.events.length).some((event) => event.phase === 'handler')).toBe(false);
        expect(response.headers().location).toBeUndefined();
      }
    }
  }
  await page.context().clearCookies();
  const form = page.getByRole('form', { name: 'Save product', exact: true });
  const before = await state(page);
  await observeState(page, 'edit-sku-42', 'auth:unauthorized');
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  await outcome(page);
  expect((await state(page)).commits).toBe(before.commits);
  console.log(JSON.stringify({ observation: 'native-enhanced-security', comparisons: 12, expiredBrowserSession: 401 }));
});

for (const fallback of ['get', 'multipart', 'image', 'target', 'external'] as const) {
  test(`unsupported ${fallback} activation remains exactly native`, async ({ page, baseURL }) => {
    await editor(page);
    const form = page.getByRole('form', { name: 'Save product', exact: true });
    await form.getByRole('textbox').fill(`Native fallback ${fallback}`);
    await form.evaluate((node, mode) => {
      const submit = node.querySelector('button[type="submit"]');
      if (submit === null) throw new Error('Missing native submitter');
      if (mode === 'get') {
        submit.setAttribute('formmethod', 'get');
        submit.setAttribute('formaction', '/catalog');
      } else if (mode === 'multipart') {
        submit.setAttribute('formenctype', 'multipart/form-data');
        const upload = document.createElement('input'); upload.type = 'file'; upload.name = 'upload'; node.append(upload);
      } else if (mode === 'image') {
        const image = document.createElement('input'); image.type = 'image'; image.name = 'image'; image.src = '/assets/favicon.svg'; image.alt = 'Image save'; node.append(image);
      } else if (mode === 'target') submit.setAttribute('formtarget', '_blank');
    }, fallback);
    if (fallback === 'external') {
      const destination = new URL(baseURL ?? '');
      destination.hostname = 'localhost';
      destination.pathname = '/catalog/sku-42/update';
      await form.getByRole('button', { name: 'Save product', exact: true }).evaluate((button, action) => button.setAttribute('formaction', action), destination.href);
    }
    if (fallback === 'multipart') await form.locator('input[type="file"]').setInputFiles({
      name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('native file bytes'),
    });
    const context = page.context();
    await form.evaluate((node) => node.addEventListener('submit', (event) => {
      const selected: unknown = Reflect.get(event, 'submitter');
      Reflect.set(window, '__fallbackEvent', {
        eventType: event.constructor.name,
        submitter: selected instanceof HTMLElement ? selected.outerHTML : null,
        action: node.getAttribute('action'), method: node.getAttribute('method'), enctype: node.getAttribute('enctype'),
      });
    }, { once: true, capture: true }));
    const request = context.waitForEvent('request', {
      predicate: (entry) => fallback === 'get' ? entry.method() === 'GET' && new URL(entry.url()).pathname === '/catalog'
        : entry.method() === 'POST' && new URL(entry.url()).pathname === '/catalog/sku-42/update',
    });
    const response = context.waitForEvent('response', { predicate: (entry) => entry.request().method() === (fallback === 'get' ? 'GET' : 'POST')
      && new URL(entry.url()).pathname === (fallback === 'get' ? '/catalog' : '/catalog/sku-42/update') });
    const popup = fallback === 'target' ? context.waitForEvent('page') : null;
    if (fallback === 'image') await form.getByAltText('Image save').click();
    else await form.getByRole('button', { name: 'Save product', exact: true }).click();
    const actual = await request;
    await response;
    const actualHeaders = await actual.allHeaders();
    console.log(JSON.stringify({ observation: 'fallback-activation', fallback,
      event: await page.evaluate(() => Reflect.get(window, '__fallbackEvent')),
      request: actual.url(), method: actual.method(), accept: actualHeaders.accept }));
    expect(actualHeaders.accept).toContain('text/html');
    expect(actualHeaders.accept).not.toContain('application/vnd.fluo.form+json');
    if (fallback === 'multipart') {
      const contentType = actualHeaders['content-type'] ?? '';
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/u);
      const boundary = contentType.split('boundary=')[1];
      const observed = (await state(page)).uploads.find((upload) => upload.contentType === contentType);
      expect(observed?.bytes).toContain(`--${boundary}`);
      expect(observed?.bytes).toContain('native file bytes');
    }
    if (popup !== null) await (await popup).close();
    console.log(JSON.stringify({ observation: 'native-fallback', fallback, method: actual.method(), contentType: actual.headers()['content-type'] }));
  });
}

test('constraint-invalid and consumer-prevented submissions never reach the listener', async ({ page }) => {
  await editor(page);
  const form = page.getByRole('form', { name: 'Save product', exact: true });
  const before = await state(page);
  await form.getByRole('textbox').fill('');
  await form.evaluate((node) => {
    Reflect.set(window, '__invalid', new Promise<void>((resolve) => node.addEventListener('invalid', () => resolve(), { once: true, capture: true })));
  });
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  await page.evaluate(() => Reflect.get(window, '__invalid'));
  expect((await state(page)).requests).toBe(before.requests);
  await form.getByRole('textbox').fill('Prevented input');
  await form.evaluate((node) => {
    Reflect.set(window, '__prevented', new Promise<void>((resolve) => node.addEventListener('submit', (event) => {
      event.preventDefault(); resolve();
    }, { once: true, capture: true })));
  });
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  await page.evaluate(() => Reflect.get(window, '__prevented'));
  expect((await state(page)).requests).toBe(before.requests);
});

async function resourceAck(page: Page): Promise<string> {
  await page.getByRole('status', { name: 'Resource acknowledgement', exact: true }).evaluate((output) => {
    Reflect.set(window, '__resourceAck', new Promise<string>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const text = output.textContent ?? '';
        observer.disconnect(); clearTimeout(timeout); resolve(text);
      });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Resource did not acknowledge')); }, 10_000);
      observer.observe(output, { childList: true, subtree: true, characterData: true });
    }));
  });
  await page.getByRole('button', { name: 'Probe shell resource', exact: true }).click();
  return page.evaluate(() => Reflect.get(window, '__resourceAck'));
}

test('public prefetch and an older streamed read cannot replace fresh saved data or its resource', async ({ page }) => {
  await page.goto('/catalog/login');
  await hydrated(page);
  const firstAck = await resourceAck(page);
  const identity = firstAck.split(':')[0];
  const prefetch = page.waitForResponse((response) => new URL(response.url()).pathname === '/catalog/sku-42'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await page.getByRole('link', { name: 'Read sku-42', exact: true }).hover();
  expect((await prefetch).headers()['x-fluo-navigation-prefetch']).toBe('public');
  await page.getByRole('link', { name: 'Read sku-42', exact: true }).click();
  await hydrated(page);
  await page.evaluate(() => { location.hash = 'retained-fragment'; });
  const historyLength = await page.evaluate(() => history.length);
  await arm(page, 'hold-read');
  const oldStarted = page.request.get('/__forms/started');
  const oldReadHeaders = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await oldStarted;
  await oldReadHeaders;
  const form = page.getByRole('form', { name: 'Save product', exact: true });
  await form.getByRole('textbox').fill('Authoritative newer product');
  const newRead = page.waitForResponse((response) => response.request().method() === 'GET'
    && response.request().headers().accept?.includes('react-navigation') === true);
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  const approved = await (await newRead).json();
  expect(approved.metadata).toMatchObject({
    title: 'Catalog: Authoritative newer product',
    links: [{ rel: 'canonical', href: '/catalog/sku-42' }],
  });
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Authoritative newer product');
  await expect(page).toHaveTitle(approved.metadata.title);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', '/catalog/sku-42');
  await page.request.post('/__forms/release');
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Authoritative newer product');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(new URL(page.url()).hash).toBe('#retained-fragment');
  const nextAck = await resourceAck(page);
  expect(nextAck.split(':')[0]).toBe(identity);
  expect(Number(nextAck.split(':')[1])).toBe(Number(firstAck.split(':')[1]) + 1);
  await page.getByRole('link', { name: 'Product list', exact: true }).click();
  await expect(page.locator('[data-product="sku-42"]')).toHaveText('Authoritative newer product');
  console.log(JSON.stringify({ observation: 'prefetch-old-read-freshness', resource: identity, acknowledged: true, historyAndFragmentPreserved: true }));
});

for (const intent of ['cancel', 'navigate', 'scope'] as const) {
  test(`a late committed acknowledgement cannot outlive ${intent} intent`, async ({ page }) => {
    await editor(page);
    const form = page.getByRole('form', { name: 'Save product', exact: true });
    await form.getByRole('textbox').fill(`Committed before ${intent}`);
    const before = await arm(page, 'hold-after');
    const started = page.request.get('/__forms/started');
    await form.getByRole('button', { name: 'Save product', exact: true }).click();
    await started;
    expect((await state(page)).commits - before.commits).toBe(1);
    if (intent === 'cancel') {
      await observeState(page, 'edit-sku-42', 'uncertain:cancelled');
      await form.getByRole('button', { name: 'Cancel waiting' }).click();
      await outcome(page);
    } else if (intent === 'navigate') {
      const approved = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/catalog');
      await page.getByRole('link', { name: 'Product list', exact: true }).click();
      await approved;
      await expect(page.getByRole('heading', { name: 'Catalog', exact: true })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Switch user and prefetch scope', exact: true }).click();
      await expect(page.locator('[data-form-state="edit-sku-42"]')).toContainText('idle');
    }
    const cleaned = page.request.get('/__forms/cleaned');
    await page.request.post('/__forms/release');
    await cleaned;
    expect((await state(page)).requests - before.requests).toBe(1);
    if (intent === 'navigate') expect(new URL(page.url()).pathname).toBe('/catalog');
    else await expect(page.locator('[data-form-state="edit-sku-42"]')).not.toContainText('saved');
    console.log(JSON.stringify({ observation: 'late-intent', intent, commit: 1, posts: 1, cleanup: true, staleApproval: false }));
  });
}

test('explicit domain form rejection keeps HTTP status and editable input without persistence', async ({ page }) => {
  await editor(page);
  const form = page.getByRole('form', { name: 'Save product', exact: true });
  await form.getByRole('textbox').fill('Reserved product');
  const before = await arm(page, 'form-errors');
  await observeState(page, 'edit-sku-42', 'validation');
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/catalog/sku-42/update');
  await form.getByRole('button', { name: 'Save product', exact: true }).click();
  const response = await rejected;
  expect(response.status()).toBe(400);
  const wire = await response.json();
  expect(wire).toMatchObject({ version: 1, outcome: 'validation', fieldErrors: {} });
  expect(wire.formErrors).toHaveLength(1);
  await outcome(page);
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('textbox')).toHaveValue('Reserved product');
  const after = await state(page);
  expect(after.requests - before.requests).toBe(1);
  expect(after.commits - before.commits).toBe(0);
  console.log(JSON.stringify({ observation: 'domain-form-rejection', status: 400, posts: 1, commits: 0 }));
});
