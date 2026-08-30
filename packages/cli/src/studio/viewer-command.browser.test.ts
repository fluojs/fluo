import { Buffer } from 'node:buffer';

import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runStudioViewerCommand } from './viewer-command.js';

const staticArtifact = {
  components: [
    {
      dependencies: [],
      details: {
        host: 'localhost',
      },
      health: { status: 'healthy' },
      id: 'redis.default',
      kind: 'redis',
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: { critical: true, status: 'ready' },
      state: 'ready',
      telemetry: {
        namespace: 'fluo.redis',
        tags: {
          env: 'test',
        },
      },
    },
    {
      dependencies: ['redis.default'],
      details: {
        workers: 2,
      },
      health: { status: 'degraded' },
      id: 'queue.default',
      kind: 'queue',
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: { critical: false, status: 'degraded' },
      state: 'degraded',
      telemetry: {
        namespace: 'fluo.queue',
        tags: {
          env: 'test',
        },
      },
    },
  ],
  diagnostics: [
    {
      code: 'QUEUE_WARNING',
      componentId: 'queue.default',
      dependsOn: ['redis.default'],
      fixHint: 'Verify Redis connectivity and queue configuration.',
      message: 'Queue dependency is degraded.',
      severity: 'warning',
    },
    {
      code: 'REDIS_ERROR',
      componentId: 'redis.default',
      dependsOn: [],
      fixHint: 'Verify Redis connectivity.',
      message: 'Redis connection failed.',
      severity: 'error',
    },
  ],
  generatedAt: '2026-08-30T00:00:00.000Z',
  health: { status: 'degraded' },
  readiness: { critical: true, status: 'degraded' },
};

type BrowserViewer = {
  readonly browser: Browser;
  readonly browserErrors: string[];
  readonly context: BrowserContext;
  readonly failedRequests: string[];
  readonly launched: Promise<number>;
  readonly page: Page;
  readonly shutdown: AbortController;
};

async function launchBrowserViewer(): Promise<BrowserViewer> {
  const shutdown = new AbortController();
  let resolveViewerUrl: (url: string) => void = () => undefined;
  const announcedViewerUrl = new Promise<string>((resolve) => {
    resolveViewerUrl = resolve;
  });
  const launched = runStudioViewerCommand(['--port', '0'], {
    stdout: {
      write: (message) => resolveViewerUrl(String(message).replace('Studio viewer: ', '').trim()),
    },
    waitForShutdown: () =>
      new Promise((resolve) => {
        shutdown.signal.addEventListener('abort', () => resolve(), { once: true });
      }),
  });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const browserErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        browserErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    const mountedHeading = page.getByRole('heading', { name: 'Runtime-connected live devtool' }).waitFor();
    await page.goto(await announcedViewerUrl, { waitUntil: 'domcontentloaded' });
    await mountedHeading;

    return { browser, browserErrors, context, failedRequests, launched, page, shutdown };
  } catch (error) {
    await context?.close();
    await browser?.close();
    shutdown.abort();
    await launched;
    throw error;
  }
}

describe('Studio viewer browser acceptance', () => {
  let viewer: Promise<BrowserViewer> | undefined;

  beforeAll(() => {
    viewer = launchBrowserViewer();
    return viewer;
  });

  afterAll(async () => {
    if (!viewer) {
      return;
    }

    const activeViewer = await viewer;
    await activeViewer.context.close();
    await activeViewer.browser.close();
    activeViewer.shutdown.abort();
    await activeViewer.launched;
  });

  it('mounts and inspects a static artifact through the HTTP launch command', async () => {
    // Given a mounted HTTP viewer with browser events subscribed during setup.
    if (!viewer) {
      throw new Error('Studio browser viewer did not start.');
    }
    const activeViewer = await viewer;

    // When Chromium imports a report artifact through the viewer file control.
    const loadedNotice = activeViewer.page.getByText('Diagnostics file loaded successfully.').waitFor();
    const warningVisible = activeViewer.page.getByText('Queue dependency is degraded.').first().waitFor();
    const errorVisible = activeViewer.page.getByText('Redis connection failed.').first().waitFor();
    await activeViewer.page.locator('#file-input').setInputFiles({
      buffer: Buffer.from(JSON.stringify(staticArtifact)),
      mimeType: 'application/json',
      name: 'studio-artifact.json',
    });
    await Promise.all([loadedNotice, warningVisible, errorVisible]);

    // Then React renders diagnostics, applies filtering, and exports Mermaid from the loaded artifact.
    const errorHidden = activeViewer.page.getByText('Redis connection failed.').first().waitFor({ state: 'hidden' });
    await activeViewer.page.locator('#severity-warning').check();
    await errorHidden;
    const mermaidText = await activeViewer.page.getByText(/^graph TD/).textContent();
    if (!mermaidText) {
      throw new Error('Studio did not render Mermaid output for the loaded artifact.');
    }
    expect(mermaidText).toContain('graph TD');
    expect(mermaidText).toContain('queue.default');
    const copiedNotice = activeViewer.page.getByText('Mermaid copied to clipboard.').waitFor();
    await activeViewer.page.getByRole('button', { name: 'Copy Mermaid' }).click();
    await copiedNotice;
    expect(await activeViewer.page.evaluate(() => navigator.clipboard.readText())).toBe(mermaidText);
    expect(activeViewer.browserErrors).toEqual([]);
    expect(activeViewer.failedRequests).toEqual([]);
  });
});
