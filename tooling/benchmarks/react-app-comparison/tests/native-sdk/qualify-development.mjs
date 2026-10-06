import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCollectorSources, captureIsolatedEnvironment, collectDevMeasurements,
  collectMeasurements, mergeEvidence, verifyMeasurementEnvironment, verifyTraceFiles } from '../../src/measure.mjs';
import { createBrowserDriver } from '../../src/measure-browser.mjs';
import { startServers, stopServers } from '../../src/run-gate.mjs';

// Finite actual-browser qualification, not a four-framework performance cycle.
// Only the original Next two-warmup/one-measured prefix is executed. Every other
// planned slot remains an explicit correctness failure, never accepted evidence.
const suite = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(process.argv[2]);
const output = resolve(root, 'development-qualification');
const resume = process.argv.includes('--resume-development');
const attempt = process.argv.find((arg) => arg.startsWith('--attempt='))?.slice('--attempt='.length) ?? '1';
assert.match(attempt, /^[1-9][0-9]*$/u);
const retry = `development-retry-${attempt}`;
const receiptPath = resolve(root, resume ? `${retry}.json` : 'development-qualification.json');
const sha = (raw) => createHash('sha256').update(raw).digest('hex');
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const original = JSON.parse(await readFile(resolve(root, 'original-config.json')));
const host = JSON.parse(await readFile(resolve(root, 'host.json')));
const frozen = JSON.parse(await readFile(resolve(root, 'frozen-inputs.json')));
const expectedSources = JSON.parse(await readFile(resolve(root, 'source-closure.json')));
const verifyInputs = async () => {
  const actual = {};
  for (const name of (await readdir(resolve(suite, 'src'))).sort()) {
    actual[name] = sha(await readFile(resolve(suite, 'src', name)));
  }
  assert.deepEqual(actual, expectedSources);
  for (const [path, hash] of Object.entries(frozen.files)) assert.equal(sha(await readFile(path)), hash, path);
  assert.equal(Object.keys(frozen.files).length, 434);
};
const selected = (receipt) => [...receipt.warmups, ...receipt.runs]
  .filter((run) => run.framework === 'next' && run.cycle <= 3);
const verifyReceipt = async (receipt) => {
  await verifyInputs();
  assert.equal(receipt.performanceAcceptance, false);
  assert.deepEqual(receipt.errors, []);
  assert.equal(receipt.cleanup.productionDriverClosed, true);
  assert.equal(receipt.cleanup.developmentDriverClosed, true);
  assert.equal(receipt.cleanup.serversStopped, true);
  for (const evidence of [receipt.production, receipt.development, receipt.combined]) {
    await verifyMeasurementEnvironment(evidence, output);
  }
  const runs = selected(receipt.development);
  assert.deepEqual(runs.map((run) => run.warmup), [true, true, false]);
  assert.ok(runs.every((run) => run.correctness === 'pass'));
  for (const run of runs) {
    const raw = JSON.parse(await readFile(run.trace));
    let previousEnd = -Infinity;
    for (const kind of ['cold-ready', 'react-edit', 'css-edit', 'server-edit']) {
      const timing = raw.timings[kind];
      const headroom = timing.environmentHeadroom;
      assert.ok(headroom.before.monotonicMs > previousEnd);
      assert.ok(headroom.elapsedMs >= timing.durationMs);
      previousEnd = headroom.after.monotonicMs;
      const altered = structuredClone(raw);
      delete altered.timings[kind].environmentHeadroom;
      const path = resolve(output, `missing-${kind}.json`);
      await save(path, altered);
      await assert.rejects(verifyTraceFiles([{ ...run, trace: path }], output), /headroom/u);
    }
  }
  assert.equal(receipt.production.runs.length, 20);
  assert.equal(receipt.development.runs.length, 20);
  assert.equal(receipt.combined.runs.length, 20);
  assert.ok(receipt.production.runs.filter((run) => run.framework !== 'next' || run.cycle > 3)
    .every((run) => run.correctness === 'fail'));
  assert.ok(receipt.development.runs.filter((run) => run.framework !== 'next' || run.cycle > 3)
    .every((run) => run.correctness === 'fail'));
};
if (process.argv.includes('--verify')) {
  await verifyReceipt(JSON.parse(await readFile(receiptPath)));
  process.stdout.write('DEVELOPMENT_INDEPENDENT_REPLAY=PASS (qualification only)\n');
} else {
  if (!resume) await mkdir(output);
  await verifyInputs();
  const representative = JSON.parse(await readFile(resolve(suite, 'config/representative.json')));
  const product = resolve(root, 'next-product');
  const receipt = { kind: 'FA-V3-finite-development-headroom-qualification',
    performanceAcceptance: false, sourceClosure: expectedSources,
    startedNs: process.hrtime.bigint().toString(), errors: [], cleanup: {} };
  let servers = [], productionDriver, developmentDriver;
  const children = [];
  try {
    const definition = representative.servers.next;
    if (!resume) servers = await startServers([{ ...definition, name: 'next', cwd: product,
      readyPattern: new RegExp(definition.readyPattern), urlForMatch: () => definition.url }],
    (child) => children.push(child));
    const config = { ...original, methodVersion: 'FA-V3', measurementPurpose: 'integrated',
      measurementKind: 'production', pairId: 'finite-development-3885', pairPhase: 'before',
      serverPids: { ...original.serverPids, ...(servers.length ? { next: servers[0].child.pid } : {}) },
      dev: Object.fromEntries(Object.entries(representative.dev).map(([name, commands]) =>
        [name, { ...commands, cwd: name === 'next' ? product : resolve(suite, 'apps', name) }])),
      provenance: { ...original.provenance,
        baselineSha256: sha(await readFile(resolve(suite, 'baseline.json'))),
        collectorSources: await captureCollectorSources() } };
    const bind = async (settings, directory, invocationId) => {
      await mkdir(directory);
      await save(resolve(directory, 'config.json'), settings);
      settings.environmentBinding = await captureIsolatedEnvironment(settings,
        { method: 'isolated-linux-representative-v1', invocationId, host }, directory);
      settings.isolatedRepresentative = true;
    };
    const productionPath = resolve(output, 'production');
    const qualify = (driver) => ({
      browserVersion: driver.browserVersion,
      async check(item) {
        if (item.framework !== 'next' || item.cycle > 3) return { pass: false,
          steps: [{ name: 'outside-finite-qualification-prefix', pass: false }] };
        const correctness = await driver.check(item);
        assert.equal(correctness.pass, true, JSON.stringify(correctness.steps));
        return correctness;
      },
      measure: (item) => driver.measure(item),
      measureDev: (item, settings, kind) => driver.measureDev(item, settings, kind),
      restartDev: (item) => driver.restartDev(item),
      closeDev: (item) => driver.closeDev(item),
    });
    if (resume) {
      const previous = JSON.parse(await readFile(resolve(root, 'development-qualification.json')));
      assert.deepEqual(previous.sourceClosure, expectedSources);
      assert.equal(previous.cleanup.productionDriverClosed, true);
      assert.equal(previous.cleanup.serversStopped, true);
      receipt.production = previous.production;
      await verifyMeasurementEnvironment(receipt.production, output);
      Object.assign(config, JSON.parse(await readFile(resolve(productionPath, 'config.json'))));
      config.environmentBinding = receipt.production.environmentBinding;
      config.isolatedRepresentative = true;
    } else {
      await bind(config, productionPath, 'development-3885-production');
      productionDriver = await createBrowserDriver(config);
      receipt.production = await collectMeasurements(config, qualify(productionDriver), resolve(productionPath, 'traces'));
      await productionDriver.close();
    }
    receipt.cleanup.productionDriverClosed = true;
    productionDriver = null;
    await stopServers(servers);
    receipt.cleanup.serversStopped = true;
    servers = [];
    const { environmentBinding, isolatedRepresentative, ...common } = config;
    const developmentConfig = { ...common, measurementKind: 'development',
      measurementPurpose: 'timing', nativeLifetime: { enabled: false } };
    const developmentPath = resolve(output, resume ? retry : 'development');
    await bind(developmentConfig, developmentPath, resume ? `development-3885-retry-${attempt}` : 'development-3885-development');
    developmentDriver = await createBrowserDriver(developmentConfig, { devMode: true });
    receipt.development = await collectDevMeasurements(developmentConfig, qualify(developmentDriver),
      resolve(developmentPath, 'traces'));
    await developmentDriver.close();
    receipt.cleanup.developmentDriverClosed = true;
    developmentDriver = null;
    receipt.combined = await mergeEvidence(receipt.production, receipt.development,
      resolve(output, resume ? `combined-retry-${attempt}` : 'combined'));
  } catch (error) {
    receipt.errors.push(String(error.stack ?? error));
    throw error;
  } finally {
    await productionDriver?.close();
    await developmentDriver?.close();
    await stopServers(servers);
    receipt.cleanup.servers = children.map((child) => ({ pid: child.pid, code: child.exitCode, signal: child.signalCode }));
    receipt.endedNs = process.hrtime.bigint().toString();
    await verifyInputs();
    await save(receiptPath, receipt);
  }
  await verifyReceipt(receipt);
  process.stdout.write('DEVELOPMENT_COLLECTION_AND_COMBINED_REPLAY=PASS (qualification only)\n');
}
