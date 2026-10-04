import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { captureCollectorSources, captureIsolatedEnvironment, planMeasurements, PROFILES,
  verifyTraceFiles, verifyEnvironmentBinding } from '../../src/measure.mjs';
import { captureMethodBinding, verifyMethodBinding, verifyMethodTrace } from '../../src/fa-v2.mjs';
import { createBrowserDriver } from '../../src/measure-browser.mjs';
import { startServers, stopServers } from '../../src/run-gate.mjs';
import { verifyNativeLifetimeEvidence, NATIVE_LIFETIME_IDENTITY } from '../../src/native-lifetime.mjs';

const suite = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(process.argv[2]);
const sha = (raw) => createHash('sha256').update(raw).digest('hex');
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const frozen = JSON.parse(await readFile(resolve(root, 'frozen-inputs.json')));
const original = JSON.parse(await readFile(resolve(root, 'original-config.json')));
const host = JSON.parse(await readFile(resolve(root, 'host.json')));
const receiptPath = resolve(root, 'qualification.json');
const expectedSources = JSON.parse(await readFile(resolve(root, 'source-closure.json')));
const output = resolve(root, process.argv.includes('--development-prefix')
  ? 'development-qualification' : 'browser');
const verifySources = async () => {
  const actual = Object.fromEntries((await readdir(resolve(suite, 'src'))).sort().map((name) => [name, null]));
  for (const name of Object.keys(actual)) actual[name] = sha(await readFile(resolve(suite, 'src', name)));
  assert.deepEqual(actual, expectedSources);
};
const verifyFrozen = async () => {
  for (const [path, hash] of Object.entries(frozen.files)) assert.equal(sha(await readFile(path)), hash, path);
  return Object.keys(frozen.files).length;
};
if (process.argv.includes('--verify')) {
  const receipt = JSON.parse(await readFile(receiptPath));
  await verifySources();
  assert.equal(await verifyFrozen(), 434);
  assert.equal(receipt.captures.length, 3);
  assert.deepEqual(receipt.errors, []);
  assert.equal(receipt.cleanup.driverClosed, true);
  assert.equal(receipt.cleanup.serversStopped, true);
  assert.ok(receipt.cleanup.servers.every((entry) => entry.code !== null || entry.signal !== null));
  await verifyEnvironmentBinding(receipt.environmentBinding, output);
  await verifyMethodBinding(receipt.methodBinding, output);
  for (const capture of receipt.captures) {
    await verifyTraceFiles([capture.run], output);
    const raw = JSON.parse(await readFile(capture.run.trace));
    assert.ok(raw.correctness.pass);
    assert.deepEqual(raw.qualityFailures, []);
    assert.equal(raw.requests.filter((entry) => entry.resourceType === 'throughput').length, 200);
    assert.ok(!raw.requests.some((entry) => entry.kind === 'request-pending'));
    assert.equal(raw.environment.browserVersion, NATIVE_LIFETIME_IDENTITY.browserVersion);
    const native = raw.artifacts.nativeLifetimeObserver;
    const ledger = JSON.parse(await readFile(raw.artifacts.nativeTerminalObserver.cdpTrace)).ledger;
    assert.deepEqual(await verifyNativeLifetimeEvidence(native, raw.requests, output, native.measurement, ledger), []);
    for (const mutation of [
      (value) => { delete value.artifacts.serverCpu; },
      (value) => { value.artifacts.serverCpu.pid++; },
      (value) => { value.methodBinding.executionId = 'borrowed-execution'; },
      (value) => { value.artifacts.nativeLifetimeObserver.measurement.executionId = 'borrowed-execution'; },
      (value) => { value.measurementPurpose = 'timing'; },
      (value) => { value.measurementKind = 'development'; },
      (value) => { delete value.artifacts.nativeLifetimeObserver; },
      (value) => { value.cycle = 99; },
    ]) {
      const altered = structuredClone(raw);
      mutation(altered);
      await assert.rejects(verifyMethodTrace(altered, capture.run, output));
    }
    await assert.rejects(verifyNativeLifetimeEvidence(native, raw.requests, output,
      { ...native.measurement, executionId: 'borrowed-execution' }, ledger), /measurement identity/u);
  }
  process.stdout.write(`${JSON.stringify({ verdict: 'PASS', captures: 3,
    warmups: 2, measured: 1, sourceClosure: expectedSources, performanceAcceptance: false })}\n`);
} else {
  await mkdir(output);
  const receipt = { kind: 'canonical-FA-V3-finite-qualification', performanceAcceptance: false,
    sourceClosure: expectedSources, frozenInputCount: await verifyFrozen(),
    startedNs: process.hrtime.bigint().toString(), captures: [], errors: [], cleanup: {} };
  let servers = [], driver;
  const children = [];
  try {
    await verifySources();
    const representative = JSON.parse(await readFile(resolve(suite, 'config/representative.json')));
    const definition = representative.servers.next;
    servers = await startServers([{ ...definition, name: 'next',
      cwd: resolve(root, 'next-product'),
      readyPattern: new RegExp(definition.readyPattern), urlForMatch: () => definition.url }], (child) => children.push(child));
    const config = { ...original, methodVersion: 'FA-V3', measurementPurpose: 'integrated',
      measurementKind: 'production', pairId: 'finite-canonical-3884', pairPhase: 'before',
      serverPids: { ...original.serverPids, next: servers[0].child.pid },
      provenance: { ...original.provenance, baselineSha256: sha(await readFile(resolve(suite, 'baseline.json'))),
        collectorSources: await captureCollectorSources() } };
    await save(resolve(output, 'config.json'), config);
    const invocation = { method: 'isolated-linux-representative-v1', invocationId: 'canonical-client-3884-prefix', host };
    config.environmentBinding = await captureIsolatedEnvironment(config, invocation, output);
    config.isolatedRepresentative = true;
    receipt.environmentBinding = config.environmentBinding;
    receipt.methodBinding = await captureMethodBinding(config, output);
    const plan = planMeasurements(config).filter((item) => item.framework === 'next').slice(0, 3);
    assert.deepEqual(plan.map((item) => item.warmup), [true, true, false]);
    driver = await createBrowserDriver(config);
    for (const [index, item] of plan.entries()) {
      const directory = resolve(output, `capture-${index + 1}`);
      await mkdir(directory);
      const method = { methodVersion: 'FA-V3', measurementPurpose: 'integrated',
        measurementKind: 'production', methodBinding: receipt.methodBinding };
      const correctness = await driver.check(item, config);
      assert.equal(correctness.pass, true);
      const observation = await driver.measure({ ...item, ...method, nativeTraceDirectory: directory }, config);
      const trace = resolve(directory, 'trace.json');
      await save(trace, { schemaVersion: 1, ...item, ...method, isolatedRepresentative: true,
        environmentBinding: config.environmentBinding, provenance: config.provenance,
        profileSettings: PROFILES[item.device], correctness,
        environment: { browserVersion: driver.browserVersion }, ...observation });
      const run = { ...item, ...method, trace, isolatedRepresentative: true,
        environmentBinding: config.environmentBinding, serverCpuSha256: observation.artifacts.serverCpuSha256,
        correctness: observation.qualityFailures.length ? 'inconclusive' : 'pass', metrics: observation.metrics };
      await verifyTraceFiles([run], output);
      assert.deepEqual(observation.qualityFailures, []);
      receipt.captures.push({ run });
      await save(receiptPath, receipt);
      process.stdout.write(`CANONICAL_CAPTURE_COMPLETE=${index + 1}\n`);
    }
  } catch (error) {
    receipt.errors.push(String(error.stack ?? error));
    throw error;
  } finally {
    try { await driver?.close(); receipt.cleanup.driverClosed = Boolean(driver); }
    finally {
      await stopServers(servers);
      receipt.cleanup.serversStopped = true;
      receipt.cleanup.servers = children.map((child) => ({ pid: child.pid, code: child.exitCode, signal: child.signalCode }));
      receipt.endedNs = process.hrtime.bigint().toString();
      receipt.cleanup.frozenInputCount = await verifyFrozen();
      await verifySources();
      await save(receiptPath, receipt);
    }
  }
  assert.ok(isDeepStrictEqual(receipt.errors, []));
  process.stdout.write('CANONICAL_PREFIX_COMPLETE=PASS (qualification only)\n');
}
