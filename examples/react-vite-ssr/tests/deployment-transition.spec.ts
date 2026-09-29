import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { expect, test } from '@playwright/test';

const example = resolve(import.meta.dirname, '..');
const evidence = resolve(example, '../../.omo/verification/issue-3878');
const mediaType = 'application/vnd.fluo.react-navigation+json;v=2';

type Build = {
  readonly baseUrl: string;
  readonly buildId: string;
  readonly assets: ReadonlySet<string>;
  readonly productChunk: string;
};

let outputRoot: string;
let serverA: ChildProcess;
let serverB: ChildProcess;
let proxy: Server;
let buildA: Build;
let buildB: Build;
let active: 'A' | 'B' = 'A';
let retainA = true;
let dropAChunk = false;
let origin: string;

async function buildClient(variant: 'A' | 'B', directory: string) {
  const child = spawn('pnpm', ['exec', 'vite', 'build', '--config', 'vite.client.config.ts'], {
    cwd: example,
    env: {
      ...process.env,
      REACT_VITE_BUILD_VARIANT: variant,
      REACT_VITE_CLIENT_OUTDIR: directory,
    },
    stdio: 'inherit',
  });
  const [exit] = await once(child, 'exit');
  if (exit !== 0) throw new Error(`Independent ${variant} client build exited ${String(exit)}.`);
  const raw: unknown = JSON.parse(await readFile(join(directory, '.vite/manifest.json'), 'utf8'));
  const parsed = createReactViteAssetManifest({
    base: '/assets/',
    entries: { client: 'src/entry-client.ts', server: 'src/entry-server.ts' },
    manifest: raw,
  });
  if (!parsed.ok) throw new Error(`Invalid ${variant} build manifest: ${JSON.stringify(parsed.diagnostics)}`);
  const productChunk = parsed.manifest.assetMap['src/navigation-product.ts'];
  if (productChunk === undefined) throw new Error(`${variant} build has no product chunk.`);
  return {
    buildId: parsed.manifest.buildId,
    assets: new Set(Object.values(parsed.manifest.assetMap)),
    productChunk,
  };
}

function startServer(directory: string): Promise<{ readonly child: ChildProcess; readonly baseUrl: string }> {
  const child = spawn('node', ['dist/server/main.js'], {
    cwd: example,
    env: {
      ...process.env,
      REACT_VITE_EXAMPLE_CLIENT_URL: pathToFileURL(`${directory}/`).href,
      REACT_VITE_EXAMPLE_MANIFEST_URL: pathToFileURL(join(directory, '.vite/manifest.json')).href,
      REACT_VITE_EXAMPLE_PORT: '0',
      REACT_VITE_EXAMPLE_TEST_READY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolveReady, rejectReady) => {
    let lines = '';
    const deadline = AbortSignal.timeout(15_000);
    deadline.addEventListener('abort', () => rejectReady(new Error('Production server readiness timed out.')), { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      lines += chunk.toString();
      const match = /^REACT_VITE_EXAMPLE_READY (http:\/\/[^\s]+)$/mu.exec(lines);
      if (match !== null) resolveReady({ child, baseUrl: match[1] });
    });
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.once('exit', (code) => rejectReady(new Error(`Production server exited ${String(code)} before readiness.`)));
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  outputRoot = await mkdtemp(join(evidence, 'deployment-ab-'));
  const aDirectory = join(outputRoot, 'A');
  const bDirectory = join(outputRoot, 'B');
  const [a, b] = await Promise.all([
    buildClient('A', aDirectory),
    buildClient('B', bDirectory),
  ]);
  const [aServer, bServer] = await Promise.all([startServer(aDirectory), startServer(bDirectory)]);
  serverA = aServer.child;
  serverB = bServer.child;
  buildA = { ...a, baseUrl: aServer.baseUrl };
  buildB = { ...b, baseUrl: bServer.baseUrl };
  expect(buildA.buildId).not.toBe(buildB.buildId);
  expect(buildA.productChunk).not.toBe(buildB.productChunk);
  proxy = createServer(async (request, response) => {
    try {
      const path = request.url ?? '/';
      const target = dropAChunk && path === buildA.productChunk
        ? buildB.baseUrl
        : path.startsWith('/assets/') && retainA && buildA.assets.has(path)
          ? buildA.baseUrl
          : active === 'A' ? buildA.baseUrl : buildB.baseUrl;
      const body = request.method === 'POST' ? await new Promise<Buffer>((resolveBody) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => resolveBody(Buffer.concat(chunks)));
      }) : undefined;
      const upstream = await fetch(`${target}${path}`, {
        method: request.method,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        headers: {
          accept: request.headers.accept ?? '*/*',
          ...(request.headers['content-type'] === undefined ? {} : { 'content-type': request.headers['content-type'] }),
          ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }),
          ...(request.headers['x-example-user'] === undefined ? {} : { 'x-example-user': request.headers['x-example-user'] }),
        },
      });
      const headers = Object.fromEntries([...upstream.headers].filter(([name]) =>
        name !== 'content-length' && name !== 'transfer-encoding' && name !== 'content-encoding'));
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502);
      response.end(error instanceof Error ? error.message : 'Proxy failure.');
    }
  });
  const listening = once(proxy, 'listening');
  proxy.listen(0, '127.0.0.1');
  await listening;
  const address = proxy.address();
  if (address === null || typeof address === 'string') throw new Error('Proxy did not bind.');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (proxy !== undefined) {
    const closed = once(proxy, 'close');
    proxy.close();
    await closed;
  }
  for (const child of [serverA, serverB]) {
    if (child !== undefined && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
  if (outputRoot !== undefined) await rm(outputRoot, { recursive: true, force: true });
});

test.beforeEach(() => {
  active = 'A';
  retainA = true;
  dropAChunk = false;
});

test('serves direct HTML, negotiated v2, guarded writes and missing assets through real HTTP', async ({ request, browser }) => {
  const document = await request.get(`${origin}/products/sku-42`, {
    headers: { Accept: 'text/html' },
  });
  const html = await document.text();
  const navigation = await request.get(`${origin}/products/sku-42`, {
    headers: { Accept: mediaType },
  });
  const payload: unknown = await navigation.json();
  const rejected = await request.get(`${origin}/products/x?preview=maybe`, {
    headers: { Accept: mediaType },
  });
  const denied = await request.post(`${origin}/products/sku-42`, {
    data: { name: 'Updated catalog item' },
    maxRedirects: 0,
  });
  const redirected = await request.post(`${origin}/products/sku-42`, {
    data: { name: 'Updated catalog item' },
    headers: { 'x-example-user': 'catalog-editor' },
    maxRedirects: 0,
  });
  const absent = await request.get(`${origin}/assets/navigation-product-missing.js`);
  const favicon = await request.get(`${origin}/assets/favicon.svg`);
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await noScript.newPage();
    const ordinary = await page.goto(`${origin}/admin/qr`);
    expect(ordinary?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
    await page.getByRole('link', { name: 'Open admin songs' }).click();
    await expect(page.getByRole('heading', { name: 'Admin songs' })).toBeVisible();
  } finally {
    await noScript.close();
  }

  expect(document.status()).toBe(200);
  expect(document.headers()['content-type']).toContain('text/html');
  expect(document.headers().vary).toContain('Accept');
  expect(document.headers()['cache-control']).toBe('private, no-store');
  expect(html).toContain(buildA.buildId);
  expect(html).toContain('/assets/entry-client-');
  expect(html).toContain('/assets/favicon.svg');
  expect(navigation.status()).toBe(200);
  expect(navigation.headers()['content-type']).toContain('v="2"');
  expect(navigation.headers().vary).toContain('Accept');
  expect(navigation.headers()['cache-control']).toBe('private, no-store');
  expect(payload).toMatchObject({ version: 2, buildId: buildA.buildId });
  expect(rejected.status()).toBe(400);
  expect(rejected.headers()['content-type']).not.toContain('react-navigation');
  expect(denied.status()).toBe(403);
  expect(redirected.status()).toBe(303);
  expect(redirected.headers().location).toContain('?updated=true');
  expect(redirected.headers()['x-example-middleware']).toBe('react-native-form');
  expect(redirected.headers()['x-example-interceptor']).toBe('request-scoped');
  expect(absent.status()).toBe(404);
  expect(absent.headers()['x-fluo-asset-status']).toBe('missing');
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['cache-control']).not.toContain('immutable');
  console.log(JSON.stringify({
    buildId: buildA.buildId,
    direct: { status: document.status(), contentType: document.headers()['content-type'], vary: document.headers().vary, cache: document.headers()['cache-control'] },
    v2: { status: navigation.status(), contentType: navigation.headers()['content-type'], vary: navigation.headers().vary, cache: navigation.headers()['cache-control'] },
    dto: rejected.status(), denied: denied.status(),
    redirect: {
      status: redirected.status(),
      middleware: redirected.headers()['x-example-middleware'],
      interceptor: redirected.headers()['x-example-interceptor'],
    },
    missingAsset: { status: absent.status(), diagnostic: absent.headers()['x-fluo-asset-status'] },
    javaScriptDisabled: 200,
  }));
});

test('retains A assets and shell on B mismatch, then explicitly updates to B', async ({ page }) => {
  // Given: a hydrated A document and a distinct, independently built B server.
  const first = await page.goto(`${origin}/admin/qr`);
  expect(first?.status()).toBe(200);
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).not.toBeEmpty();
  const resourceA = await page.evaluate(() => window.__reactResource?.id);
  expect(resourceA).toBeDefined();
  const retained = await page.request.get(`${origin}${buildA.productChunk}`);
  expect(retained.status()).toBe(200);
  expect(retained.headers()['cache-control']).toContain('immutable');
  active = 'B';
  const approval = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/admin/songs'
    && response.request().headers().accept === mediaType);

  // When: A's tab requests a B navigation while old hashed assets are retained.
  await page.getByRole('link', { name: 'Open admin songs' }).click();
  const navigation = await approval;
  expect(navigation.status()).toBe(200);
  expect((await navigation.json()).buildId).toBe(buildB.buildId);
  await expect(page.getByRole('alert')).toContainText('incompatible-build');
  await expect(page).toHaveURL(`${origin}/admin/qr`);
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resourceA);
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).toContainText(resourceA ?? '');
  await page.screenshot({ path: join(evidence, 'deployment-incompatible-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Update application (open full document)' })).toBeVisible();
  await page.screenshot({ path: join(evidence, 'deployment-incompatible-mobile.png') });

  // Then: only the explicit update loads a B document; B-only code works afterward.
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Update application (open full document)' }).click();
  await loaded;
  await expect(page.locator('html')).toHaveAttribute('data-build-id', buildB.buildId);
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).not.toBeEmpty();
  expect(await page.evaluate(() => window.__reactResource?.id)).not.toBe(resourceA);
  const bOnly = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/deployment/b-only'
    && response.request().headers().accept === mediaType);
  await page.getByRole('link', { name: 'Open B-only page' }).click();
  expect((await bOnly).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'B-only browser destination' })).toBeVisible();
});

test('classifies a missing mapped A chunk as import failure without losing the shell', async ({ page }) => {
  // Given: A's admin page has not imported the A product chunk.
  await page.goto(`${origin}/admin/qr`);
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await expect(page.getByTestId('resource-ack')).not.toBeEmpty();
  const resourceA = await page.evaluate(() => window.__reactResource?.id);
  retainA = false;
  active = 'B';
  const missingAsset = page.waitForResponse((response) =>
    new URL(response.url()).pathname === buildA.productChunk);
  const mismatched = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/sku-84'
    && response.request().headers().accept === mediaType);

  // When: B HTTP rejects A's build before attempting its now-missing A chunk.
  await page.getByRole('link', { name: 'Open sku-84' }).click();
  expect((await mismatched).status()).toBe(200);
  await expect(page.getByRole('alert')).toContainText('incompatible-build');
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resourceA);
  // Switch HTTP back to A while leaving its product asset unavailable at the B host.
  active = 'A';
  dropAChunk = true;
  const approved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/products/sku-84'
    && response.request().headers().accept === mediaType);
  await page.getByRole('link', { name: 'Open sku-84' }).click();
  expect((await approved).status()).toBe(200);
  const asset = await missingAsset;

  // Then: the real asset controller reports 404 and the mapped importer reports import-failure.
  expect(asset.status()).toBe(404);
  expect(asset.headers()['x-fluo-asset-status']).toBe('missing');
  await expect(page.getByRole('alert')).toContainText('import-failure');
  await expect(page).toHaveURL(`${origin}/admin/qr`);
  expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resourceA);
  await expect(page.getByRole('heading', { name: 'Admin QR' })).toBeVisible();
  await page.screenshot({ path: join(evidence, 'deployment-missing-asset-desktop.png') });
});
