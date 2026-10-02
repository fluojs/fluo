import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { chromium } from '@playwright/test';
import { installInitialReadiness, waitForInitialReadiness } from '../src/initial-readiness.mjs';

const root = new URL('../', import.meta.url);
const app = new URL('apps/fluo/', root);

test('canonical dev serves live edits without a production rebuild and shuts down its children', { timeout: 120_000 }, async (t) => {
  const config = JSON.parse(await readFile(new URL('config/representative.json', root), 'utf8')).dev.fluo;
  const probe = createServer();
  const listening = once(probe, 'listening');
  probe.listen(0, '127.0.0.1');
  await listening;
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  const productionEntry = new URL('dist/server/main.js', app);
  const before = await stat(productionEntry).catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const child = spawn(process.execPath, [fileURLToPath(new URL('src/fluo-dev.mjs', root))], {
    cwd: fileURLToPath(app),
    detached: true,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const observers = new Set();
  const observe = (chunk) => {
    const text = chunk.toString().replace(/\u001b\[[0-9;]*m/gu, '');
    output += text;
    process.stdout.write(text);
    for (const observer of observers) observer(text);
  };
  child.stdout.on('data', observe);
  child.stderr.on('data', observe);
  const exited = once(child, 'exit');
  const nextReady = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observers.delete(observer);
      reject(new Error(`Canonical dev readiness timeout:\n${output}`));
    }, 30_000);
    const observer = (text) => {
      if (text.includes('[fluo] React dev app ready')) {
        clearTimeout(timer);
        observers.delete(observer);
        resolve();
      }
    };
    observers.add(observer);
  });
  const restores = new Map();
  let browser;
  let ownedPids = [];
  try {
    await nextReady();
    const processes = execFileSync('ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' });
    ownedPids = processes.trim().split('\n').map((line) => line.trim().split(/\s+/u).map(Number))
      .filter(([, group]) => group === child.pid).map(([pid]) => pid);
    assert.ok(ownedPids.length >= 3, 'wrapper, CLI supervisor and Vite application are running');
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Refresh expects the DevTools renderer registry in development.
    // The existing completion observer forwards this hook rather than replacing it.
    await page.addInitScript(() => {
      const renderers = new Map();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers,
        inject(renderer) {
          const id = renderers.size + 1;
          renderers.set(id, renderer);
          return id;
        },
        onScheduleFiberRoot() {},
        onCommitFiberRoot() {},
        onCommitFiberUnmount() {},
      };
    });
    await installInitialReadiness(page);
    await page.goto(`${base}/login`);
    await waitForInitialReadiness(page);
    await page.locator('h1').filter({ hasText: 'Editor login' }).waitFor({ state: 'visible' });
    await page.evaluate(() => { window.__devDocumentIdentity = 'original'; });

    await t.test('CSS HMR changes the visible computed style in the same document', async () => {
      const edit = config.edits['css-edit'];
      const file = new URL(edit.file, app);
      const source = await readFile(file, 'utf8');
      restores.set(file, source);
      await page.evaluate((edit) => {
        window.__visibleEdit = new Promise((resolve, reject) => {
          const observer = new MutationObserver(() => {
            const value = getComputedStyle(document.querySelector(edit.selector))
              .getPropertyValue(edit.expectedStyle.property);
            if (value.trim() === edit.expectedStyle.value) {
              clearTimeout(timer);
              observer.disconnect();
              resolve(value.trim());
            }
          });
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('CSS HMR did not update the visible style.'));
          }, 15_000);
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        });
      }, edit);
      await writeFile(file, source.replace(edit.from, edit.to));
      assert.equal(await page.evaluate(() => window.__visibleEdit), 'changed');
      assert.equal(await page.evaluate(() => window.__devDocumentIdentity), 'original');
    });

    await t.test('React edit reaches the mounted destination and fresh SSR', async () => {
      const edit = config.edits['react-edit'];
      const file = new URL(edit.file, app);
      const source = await readFile(file, 'utf8');
      restores.set(file, source);
      await page.evaluate((edit) => {
        window.__visibleEdit = new Promise((resolve, reject) => {
          const observer = new MutationObserver(() => {
            if (document.querySelector(edit.selector)?.textContent === edit.expectedText) {
              clearTimeout(timer);
              observer.disconnect();
              resolve();
            }
          });
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('React HMR did not update the mounted destination.'));
          }, 15_000);
          observer.observe(document, { subtree: true, childList: true, characterData: true });
        });
      }, edit);
      await writeFile(file, source.replace(edit.from, edit.to));
      await page.evaluate(() => window.__visibleEdit);
      assert.equal(await page.locator('h1').textContent(), edit.expectedText);
      assert.equal(await page.evaluate(() => window.__devDocumentIdentity), 'original');
      assert.match(await (await page.request.get(`${base}/login`)).text(), /Editor login changed/u);
    });

    await t.test('server edit restarts behind the gateway and serves the changed page', async () => {
      const edit = config.edits['server-edit'];
      const file = new URL(edit.file, app);
      const source = await readFile(file, 'utf8');
      restores.set(file, source);
      const ready = nextReady();
      await writeFile(file, source.replace(edit.from, edit.to));
      await ready;
      assert.equal(await page.evaluate(() => window.__devDocumentIdentity), 'original');
      await page.goto(`${base}/`);
      assert.equal(await page.locator('h1').textContent(), edit.expectedText);
    });
    assert.deepEqual(errors, []);
    const after = await stat(productionEntry).catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    assert.equal(after?.mtimeMs, before?.mtimeMs, 'dev must not rebuild the production entry');
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    for (const [file, source] of restores) await writeFile(file, source);
    assert.equal(signal, null);
    assert.equal(code, 0, 'canonical dev shutdown must be clean');
    for (const pid of ownedPids) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `owned process ${pid} survived shutdown`);
    }
    assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' }, 'owned process group survived shutdown');
    const closed = createServer();
    const rebound = once(closed, 'listening');
    closed.listen(port, '127.0.0.1');
    await rebound;
    await new Promise((resolve, reject) => closed.close((error) => error ? reject(error) : resolve()));
    console.log(`FLUO_DEV_CLEANUP port=${port} pids=${ownedPids.join(',')}`);
  }
});
