import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir, access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createNativeCapture } from '../../src/native-terminal.mjs';
import { reconcileNativeLifetime } from '../../src/native-lifetime.mjs';

const output = resolve(process.argv[2]);
const children = [];
const observedChromium = {
  async launchServer(options) {
    const server = await chromium.launchServer(options);
    children.push(server.process());
    return server;
  },
  connect: (...args) => chromium.connect(...args),
};
const startup = await createNativeCapture(observedChromium, resolve(output, 'startup-failure'),
  { enabled: true, python: '/missing-canonical-fixture-python', measurement: { runId: 'startup' } });
const startupPage = await startup.browser.newPage();
const startupCdp = await startupPage.context().newCDPSession(startupPage);
await startupCdp.send('Performance.enable');
await startup.prepareLifetime(startupCdp);
const { metrics } = await startupCdp.send('Performance.getMetrics');
const failedEvidence = await startup.read(metrics.find((entry) => entry.name === 'Timestamp').value);
const startupFailures = reconcileNativeLifetime([], failedEvidence.lifetime.observation, []).unavailable;
assert.ok(startupFailures.length > 0);
const interrupted = await createNativeCapture(observedChromium, resolve(output, 'interrupted'),
  { enabled: true, python: '/opt/fluo-native-debug/bin/python3.11', measurement: { runId: 'interrupted' } });
const page = await interrupted.browser.newPage();
const cdp = await page.context().newCDPSession(page);
await interrupted.prepareLifetime(cdp);
const child = children.at(-1);
const exited = once(child, 'exit', { signal: AbortSignal.timeout(15_000) });
child.kill('SIGTERM');
await exited;
const [interruption] = await Promise.allSettled([interrupted.close()]);
const cleanups = [];
for (const scenario of ['startup-failure', 'interrupted']) {
  const directory = resolve(output, scenario);
  const roots = await readdir(directory);
  assert.equal(roots.length, 1);
  const raw = JSON.parse(await readFile(resolve(directory, roots[0], 'cdp.json')));
  assert.equal(raw.cleanup.closed, true);
  assert.ok(raw.cleanup.exitCode !== null || raw.cleanup.signalCode !== null);
  await assert.rejects(access(`/proc/${raw.cleanup.pid}`), { code: 'ENOENT' });
  const native = JSON.parse(await readFile(resolve(directory, roots[0], 'lifetime.json')));
  assert.ok(reconcileNativeLifetime([], native, []).unavailable.length > 0);
  const host = JSON.parse(await readFile(resolve(directory, roots[0], 'lifetime-host.json')));
  assert.equal(host.cleanup.closed, true);
  if (host.cleanup.pid) await assert.rejects(access(`/proc/${host.cleanup.pid}`), { code: 'ENOENT' });
  cleanups.push({ scenario, ...raw.cleanup, lifecycle: raw.lifecycle });
}
await writeFile(resolve(output, 'failure-cleanup.json'), `${JSON.stringify({ verdict: 'PASS', cleanups,
  startupFailures, interruption: { status: interruption.status,
    reason: interruption.status === 'rejected' ? String(interruption.reason) : null },
  rawFailuresPreserved: true, performanceAcceptance: false }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ verdict: 'PASS', cleanups, performanceAcceptance: false })}\n`);
