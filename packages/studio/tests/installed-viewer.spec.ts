import { spawn, spawnSync, type ChildProcessByStdio, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { readViewerUrl, stopViewerProcess } from '../src/viewer-process.js';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDirectory = resolve(packageDirectory, 'evidence');
const snapshotFixture = readFileSync(join(packageDirectory, 'tests', 'fixtures', 'studio-snapshot.json'));
const commit = runCommand('git', ['rev-parse', 'HEAD'], packageDirectory).stdout.trim();
const viewports = [
  { height: 900, name: 'desktop', width: 1440 },
  { height: 844, name: 'mobile', width: 390 },
] as const;

let consumerDirectory: string | undefined;
let viewerProcess: ChildProcessByStdio<null, Readable, Readable> | undefined;
let viewerUrl: Promise<URL> | undefined;

function commandDiagnostics(command: string, arguments_: readonly string[], result: SpawnSyncReturns<string>): string {
  return [
    `${command} ${arguments_.join(' ')}`,
    `error: ${result.error?.message ?? 'none'}`,
    `signal: ${result.signal ?? 'none'}`,
    `status: ${String(result.status)}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
  ].join('\n');
}

function runCommand(command: string, arguments_: readonly string[], cwd: string): SpawnSyncReturns<string> {
  const result = spawnSync(command, arguments_, { cwd, encoding: 'utf8' });

  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error(commandDiagnostics(command, arguments_, result));
  }

  return result;
}

function pngDimensions(path: string): { readonly height: number; readonly width: number } {
  const content = readFileSync(path);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  expect([...content.subarray(0, signature.length)]).toEqual(signature);
  return { height: content.readUInt32BE(20), width: content.readUInt32BE(16) };
}

async function captureEvidence(page: Page, label: string, viewport: (typeof viewports)[number], servedUrl: URL): Promise<void> {
  mkdirSync(evidenceDirectory, { recursive: true });
  const path = join(evidenceDirectory, `issue-3333-${label}-${viewport.name}.png`);
  await page.screenshot({ fullPage: true, path });
  const dimensions = pngDimensions(path);
  const metadata = {
    browser: 'Google Chrome',
    byteSize: statSync(path).size,
    commit,
    deviceScaleFactor: 1,
    path,
    pngDimensions: dimensions,
    servedUrl: servedUrl.href,
    viewport: { height: viewport.height, width: viewport.width },
  };

  expect(metadata.byteSize).toBeGreaterThan(0);
  expect(dimensions.width).toBe(viewport.width);
  expect(dimensions.height).toBeGreaterThanOrEqual(viewport.height);
  writeFileSync(path.replace(/\.png$/u, '.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function openViewer(browser: Browser, viewport: (typeof viewports)[number]): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext({
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    viewport: { height: viewport.height, width: viewport.width },
  });
  const page = await context.newPage();
  return { context, page };
}

test.beforeAll(() => {
  const sandbox = mkdtempSync(join(tmpdir(), 'fluo-studio-installed-viewer-'));
  const tarballDirectory = join(sandbox, 'tarball');
  const installedConsumer = join(sandbox, 'consumer');
  mkdirSync(tarballDirectory);
  mkdirSync(installedConsumer);
  writeFileSync(join(sandbox, '.fluo-studio-installed-viewer.json'), '{"managed":true}\n');

  runCommand('pnpm', ['build'], packageDirectory);
  const packed = runCommand('npm', ['pack', '--json', '--pack-destination', tarballDirectory], packageDirectory);
  const packResult = JSON.parse(packed.stdout) as readonly { readonly filename: string }[];
  const tarballName = packResult[0]?.filename;
  if (!tarballName) {
    throw new Error('npm pack did not report a Studio tarball.');
  }

  runCommand('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(tarballDirectory, tarballName)], installedConsumer);
  const binary = join(installedConsumer, 'node_modules', '.bin', 'fluo-studio-viewer');
  const help = runCommand(binary, ['--help'], installedConsumer);
  expect(help.stdout).toContain('Usage: fluo-studio-viewer');
  const invalidPort = spawnSync(binary, ['--port', 'not-a-port'], { cwd: installedConsumer, encoding: 'utf8' });
  const invalidPortDiagnostics = commandDiagnostics(binary, ['--port', 'not-a-port'], invalidPort);
  expect(invalidPort.error, invalidPortDiagnostics).toBeUndefined();
  expect(invalidPort.signal, invalidPortDiagnostics).toBeNull();
  expect(invalidPort.status, invalidPortDiagnostics).toBe(1);
  expect(invalidPort.stderr, invalidPortDiagnostics).toContain('Invalid port');

  const launchedViewer = spawn(binary, ['--port', '0'], { cwd: installedConsumer, stdio: ['ignore', 'pipe', 'pipe'] });
  viewerProcess = launchedViewer;
  viewerUrl = readViewerUrl(launchedViewer);
  consumerDirectory = sandbox;
});

test.afterAll(async () => {
  if (viewerProcess) {
    await stopViewerProcess(viewerProcess);
  }
  if (consumerDirectory && existsSync(join(consumerDirectory, '.fluo-studio-installed-viewer.json'))) {
    rmSync(consumerDirectory, { force: true, recursive: true });
  }
});

test('opens the installed public viewer bin and exercises its file workflow in Chrome', async ({ browser }) => {
  if (!consumerDirectory || !viewerUrl) {
    throw new Error('Installed viewer setup did not complete.');
  }

  const url = await viewerUrl;
  const fileUrl = pathToFileURL(join(consumerDirectory, 'consumer', 'node_modules', '@fluojs', 'studio', 'dist', 'index.html'));

  for (const viewport of viewports) {
    const { context, page } = await openViewer(browser, viewport);
    try {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(url.href);
      await expect(page.locator('#app')).not.toBeEmpty();
      await captureEvidence(page, '02-http-mounted', viewport, url);

      await page.setInputFiles('#file-input', {
        buffer: snapshotFixture,
        mimeType: 'application/json',
        name: 'snapshot.json',
      });
      await expect(page.locator('#graph-host')).toContainText('redis.default');
      await expect(page.locator('#graph-host')).toContainText('queue.default');
      await expect(page.locator('.notice')).toHaveText('Diagnostics file loaded successfully.');
      await expect(page.getByRole('heading', { name: 'QUEUE_DEPENDENCY_NOT_READY' })).toBeVisible();
      await expect(page.getByText('Verify Redis connectivity and queue configuration.')).toBeVisible();
      await expect(page.getByText('components: 2')).toBeVisible();
      await expect(page.getByText('diagnostics: 1')).toBeVisible();
      await captureEvidence(page, '03-snapshot-loaded', viewport, url);

      await page.locator('#search').fill('does-not-match');
      await expect(page.getByText('components: 0')).toBeVisible();
      await expect(page.getByText('diagnostics: 0')).toBeVisible();
      await captureEvidence(page, '04-filtered-empty', viewport, url);
      await page.locator('#search').fill('');
      await expect(page.getByText('components: 2')).toBeVisible();
      await page.locator('#readiness-degraded').check();
      await expect(page.getByText('components: 1')).toBeVisible();
      await page.locator('#severity-warning').check();
      await expect(page.getByText('diagnostics: 1')).toBeVisible();
      await page.locator('#readiness-degraded').uncheck();
      await page.locator('#severity-warning').uncheck();
      await expect(page.getByText('components: 2')).toBeVisible();

      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin });
      await page.getByRole('button', { name: 'Copy Mermaid' }).click();
      await expect(page.getByText('Mermaid copied to clipboard.')).toBeVisible();
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toContain('graph TD');
      expect(clipboard).toContain('redis.default');
      expect(clipboard).toContain('queue.default');
      expect(clipboard).toContain('C2 --> C1');
      expect(clipboard).toContain('class C2 degraded');
      await captureEvidence(page, '05-mermaid-copied', viewport, url);
      expect(pageErrors).toEqual([]);

      await page.goto(fileUrl.href);
      await expect(page.locator('#app')).toBeEmpty();
      await captureEvidence(page, '01-file-origin-blank', viewport, fileUrl);
    } finally {
      await context.close();
    }
  }
});
