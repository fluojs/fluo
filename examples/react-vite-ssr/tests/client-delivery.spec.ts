import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ACCEPT = 'application/vnd.fluo.react-navigation+json;v=2';
const example = resolve(import.meta.dirname, '..');
const results = resolve(example, '../../tooling/benchmarks/react-app-comparison/results/issue-3884');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

type RequestRecord = {
  readonly type: string;
  readonly url: string;
  readonly method: string;
  readonly accept: string | null;
  readonly complete: boolean;
  readonly start: number;
  readonly response?: number;
  readonly end?: number;
};
type DeliveryObserver = {
  readonly finish: () => Promise<readonly RequestRecord[]>;
};
type DeliveryTools = {
  readonly readDeliveryVersions: (app: string) => Promise<Readonly<Record<string, unknown>>>;
  readonly captureDeliverySource: (source: string, output: string) => Promise<Readonly<Record<string, string>>>;
  readonly attributeDeliveryStages: (
    manifest: unknown, requests: readonly RequestRecord[], stages: unknown, initial: unknown, destination: unknown,
  ) => readonly unknown[];
  readonly observeDeliveryRequests: (page: Page) => Promise<DeliveryObserver>;
  readonly summarizeDeliveryRequests: (requests: readonly RequestRecord[]) => {
    readonly status: string;
    readonly duplicateTransfers: readonly unknown[];
  };
};

declare global {
  interface Window {
    __clientDelivery?: {
      readonly stages: { readonly name: string; readonly time: number }[];
      readonly signals: Map<string, Promise<void>>;
    };
  }
}

async function subscribe(page: Page, name: string, selector: string, text: string): Promise<void> {
  await page.evaluate(({ name, selector, text }) => {
    const delivery = window.__clientDelivery;
    if (!delivery) throw new Error('Delivery observers were not installed.');
    const promise = new Promise<void>((resolveSignal, rejectSignal) => {
      const observe = () => {
        const element = document.querySelector(selector);
        if (!element?.textContent?.includes(text)) return;
        observer.disconnect();
        clearTimeout(deadline);
        delivery.stages.push({ name, time: performance.now() });
        resolveSignal();
      };
      const observer = new MutationObserver(observe);
      const deadline = setTimeout(() => {
        observer.disconnect();
        rejectSignal(new Error(`Missing exact delivery signal: ${name}`));
      }, 10_000);
      observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      observe();
    });
    delivery.signals.set(name, promise);
  }, { name, selector, text });
}

async function signal(page: Page, name: string): Promise<void> {
  await page.evaluate((name) => {
    const promise = window.__clientDelivery?.signals.get(name);
    if (!promise) throw new Error(`Unregistered delivery signal: ${name}`);
    return promise;
  }, name);
}

for (const cache of ['cold', 'warm'] as const) {
  for (const activation of ['private-ordinary', 'public-prefetch'] as const) {
    test(`traces ${cache} ${activation} delivery and zero redundant initial approval`, async ({ page }, testInfo) => {
      // Given: every network observer is attached before document navigation.
      const tools: DeliveryTools = await import(new URL(
        '../../../tooling/benchmarks/react-app-comparison/src/client-delivery.mjs', import.meta.url,
      ).href);
      await page.addInitScript(() => {
        window.__clientDelivery = { stages: [], signals: new Map() };
      });
      if (cache === 'warm') {
        await page.goto('/admin/qr', { waitUntil: 'load' });
        await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
      }
      const observer = await tools.observeDeliveryRequests(page);
      const approvals: string[] = [];
      page.on('request', (request) => {
        if (request.headers().accept === ACCEPT) approvals.push(new URL(request.url()).pathname);
      });
      const diagnostics: string[] = [];
      page.on('pageerror', (error) => diagnostics.push(error.message));
      const documentResponse = await page.goto('/admin/qr', { waitUntil: 'load' });
      expect(documentResponse?.status()).toBe(200);

      // Warm the real control before the navigation stimulus, recording its React acknowledgment.
      await subscribe(page, 'hydration-control-ack', '[data-testid="resource-ack"]', ':1');
      await page.getByRole('button', { name: 'Use shell resource' }).click();
      await signal(page, 'hydration-control-ack');
      expect(approvals).toEqual([]);
      const resource = await page.evaluate(() => window.__reactResource?.id);
      const target = activation === 'private-ordinary' ? '/products/sku-84' : '/prefetch/public-84';
      const link = page.getByRole('link', {
        name: activation === 'private-ordinary' ? 'Open sku-84' : 'Prefetch public sku-84',
        exact: true,
      });
      const approval = page.waitForResponse((response) =>
        new URL(response.url()).pathname === target && response.request().headers().accept === ACCEPT);
      if (activation === 'public-prefetch') {
        await link.hover();
        expect((await approval).headers()['x-fluo-navigation-prefetch']).toBe('public');
      }
      await subscribe(page, 'rendered-commit', 'h2', activation === 'private-ordinary'
        ? 'Browser destination: Catalog item sku-84' : 'Browser destination: Prefetch public-84');

      // When: ordinary approval or the explicitly public single-use entry activates the view.
      await link.click();
      const destination: unknown = await (await approval).json();
      await signal(page, 'rendered-commit');
      await page.evaluate(() => new Promise<void>((resolvePaint) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__clientDelivery?.stages.push({ name: 'rendered-frame', time: performance.now() });
          resolvePaint();
        }));
      }));

      // Then: the request inventory and painted destination are attributable, without private caching.
      expect(approvals).toEqual([target]);
      expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resource);
      expect(diagnostics).toEqual([]);
      const requests = await observer.finish();
      const inventory = tools.summarizeDeliveryRequests(requests);
      expect(inventory.status).toBe('complete');
      expect(inventory.duplicateTransfers).toEqual([]);
      const initial = await page.evaluate(() => {
        const json = document.getElementById('fluo-initial-page')?.textContent;
        if (!json) throw new Error('No initial HTTP transfer.');
        const payload: unknown = JSON.parse(json);
        return payload;
      });
      const stages = await page.evaluate(() => window.__clientDelivery?.stages);
      const output = resolve(results, `${Date.now()}-${testInfo.workerIndex}-${cache}-${activation}`);
      await mkdir(output, { recursive: true });
      const manifest = await readFile(resolve(example, 'dist/client/.vite/manifest.json'), 'utf8');
      const attributed = tools.attributeDeliveryStages(JSON.parse(manifest), requests, stages, initial, destination);
      const [sourceIdentity, lock, packageJson] = await Promise.all([
        tools.captureDeliverySource(resolve(example, '../..'), output),
        readFile(resolve(example, '../../pnpm-lock.yaml'), 'utf8'),
        readFile(resolve(example, 'package.json'), 'utf8'),
      ]);
      await writeFile(resolve(output, 'manifest.json'), manifest);
      await writeFile(resolve(output, 'package.json'), packageJson);
      await writeFile(resolve(output, 'trace.json'), `${JSON.stringify({
        version: 1,
        complete: true,
        provenance: {
          browser: page.context().browser()?.version(),
          cache,
          activation,
          ...sourceIdentity,
          resolvedVersions: await tools.readDeliveryVersions(example),
          lockSha256: hash(lock),
          manifestSha256: hash(manifest),
          packageSha256: hash(packageJson),
          runtime: process.version,
          host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length },
          profile: 'unthrottled-correctness',
          viewport: page.viewportSize(),
          dataset: 'react-vite-ssr-example-fixture',
          buildId: await page.locator('html').getAttribute('data-build-id'),
          uncertainty: 'single correctness trace, event/DOM/CDP observation overhead; not a frozen profile receipt',
        },
        initial,
        destination,
        stages,
        attributed,
        requests,
        inventory,
        stageDefinitions: {
          html: 'CDP Document response/end',
          bootstrap: 'CDP emitted entry-client Script response/end',
          initialModule: 'HTTP-selected initial.destination.module mapped by retained manifest',
          hydration: 'real mounted shell resource control acknowledgment',
          payload: 'negotiated GET response/end, including eligible public opportunity',
          destinationModule: 'HTTP-approved destination importer and its emitted static closure',
          renderedCommit: 'exact destination DOM mutation followed by two animation frames',
        },
      }, null, 2)}\n`, { flag: 'wx' });
      console.log(`CLIENT_DELIVERY_TRACE ${output}`);
    });
  }
}

test('acknowledges warmed controls while real private approval is deferred', async ({ page }) => {
  // Given: the resource is warmed and exact signals are subscribed before each stimulus.
  await page.addInitScript(() => { window.__clientDelivery = { stages: [], signals: new Map() }; });
  await page.goto('/admin/qr');
  await subscribe(page, 'warm-ack', '[data-testid="resource-ack"]', ':1');
  await page.getByRole('button', { name: 'Use shell resource' }).click();
  await signal(page, 'warm-ack');
  const resource = await page.evaluate(() => window.__reactResource?.id);
  let release = () => {};
  const held = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  await page.route('**/products/sku-84?preview=false', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await subscribe(page, 'pending', 'nav[aria-label="Product navigation"]', 'Navigation: navigating');
    const requested = page.waitForRequest((request) =>
      new URL(request.url()).pathname === '/products/sku-84' && request.headers().accept === ACCEPT);
    await page.getByRole('link', { name: 'Open sku-84', exact: true }).click();
    await requested;
    await signal(page, 'pending');

    // When: the user operates independent shell/page controls before HTTP can approve.
    await subscribe(page, 'pending-ack', '[data-testid="resource-ack"]', ':2');
    await page.getByRole('button', { name: 'Use shell resource' }).click();
    await signal(page, 'pending-ack');
    await subscribe(page, 'shell-count', 'main > button', 'Count: 1');
    await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
    await signal(page, 'shell-count');
    await page.getByRole('button', { name: 'Page count: 0' }).click();
    await expect(page.getByRole('button', { name: 'Page count: 1' })).toBeVisible();

    // Then: the approved URL/view/resource remain usable until the held response is released.
    expect(new URL(page.url()).pathname).toBe('/admin/qr');
    expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resource);
    await subscribe(page, 'approval-commit', 'h2', 'Browser destination: Catalog item sku-84');
    release();
    await signal(page, 'approval-commit');
    expect(await page.evaluate(() => window.__reactResource?.id)).toBe(resource);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
