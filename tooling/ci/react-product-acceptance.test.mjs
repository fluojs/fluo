import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { consumeProduct, productDomainPlan, reliabilityRun, requiredRows, validateMeasurementDiagnostics,
  validateMeasurementInventory, validateReliabilityInventory } from './react-product-acceptance.mjs';

const head = '1'.repeat(40);
const tree = '2'.repeat(40);
const matrix = JSON.parse(readFileSync(new URL('../../examples/react-vite-ssr/tests/product-acceptance-matrix.json', import.meta.url)));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-product-consumer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = Buffer.from('actual deterministic fixture command completed\n');
  writeFileSync(join(root, 'command.log'), log);
  const report = Buffer.from(JSON.stringify({ errors: [], suites: [{
    specs: ['production-hydration', 'navigation-failure', 'deployment-transition', 'ssr-delivery',
      'product-acceptance', 'progressive-forms', 'background-interactions', 'session-transition',
      'navigation-guard', 'revalidation', 'product-faults', 'long-session', 'long-session-ownership',
      'long-session-cache', 'long-session-soak', 'product-authoring'].map((name) => ({
      title: name, file: `${name}.spec.ts`, tests: [
        { expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] },
      ],
    })),
  }] }));
  writeFileSync(join(root, 'browser.json'), report);
  const checks = [...new Set(matrix.rows.flatMap((row) => row.checks))].map((id) => ({
    id, head, status: 'passed', exitCode: 0, elapsedMs: 1, command: `fixture ${id}`,
    log: { path: 'command.log', sha256: digest(log) },
    browserReport: { path: 'browser.json', sha256: digest(report) },
  }));
  return { root, matrix: structuredClone(matrix), receipt: {
    version: 1, issue: 3879, stage: 'local', head, preflightSha256: '3'.repeat(64),
    source: { head, tree: '2'.repeat(40), clean: true },
    matrixSha256: digest(Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`)),
    checks,
    rows: matrix.rows.map((row) => ({ id: row.id, verdict: row.receipt === 'external' ? 'lead-owned-pending' : 'passed' })),
  } };
}

test('product matrix: removed or unknown mandatory row -> fail closed before execution', async (t) => {
  const value = fixture(t);
  assert.equal(matrix.rows.length, requiredRows.length);
  value.matrix.rows.pop();

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /mandatory row/u);
});

test('product receipt: wrong clean source/head -> cannot reuse prior execution', async (t) => {
  const value = fixture(t);
  value.receipt.source.head = '4'.repeat(40);

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /source\/head/u);
});

for (const verdict of ['skip', 'todo', 'missing', 'failed', 'source-only-pass']) {
  test(`product row: ${verdict} -> no mandatory product PASS`, async (t) => {
    const value = fixture(t);
    value.receipt.rows[0].verdict = verdict;

    await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /Missing\/skip\/failed row/u);
  });
}

test('product check: nonzero exit -> numeric policy cannot excuse runtime failure', async (t) => {
  const value = fixture(t);
  value.receipt.checks[0].exitCode = 1;

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /Unverified execution/u);
});

test('product artifact: changed bytes -> receipt authentication fails', async (t) => {
  const value = fixture(t);
  writeFileSync(join(value.root, 'command.log'), 'truncated\n');

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /digest mismatch/u);
});

test('product external proof: local source cannot manufacture review or GitHub CI PASS', async (t) => {
  const value = fixture(t);
  value.receipt.rows.find((row) => row.id === 'ci-release').verdict = 'passed';

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /external proof/u);
});

test('product reliability: missing three-engine and timed trace inventory -> incomplete', async (t) => {
  const value = fixture(t);

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /engine inventory/u);
});

test('measurement numeric diagnostics: original FAIL and INCONCLUSIVE -> disclosed without relabeling', () => {
  for (const verdict of ['fail', 'inconclusive']) {
    const value = { methodVersion: 'FA-V3', verdict, checks: [
      { metric: 'shellArrivalMs', reason: 'absolute-budget', verdict, range: [700, 900] },
    ] };

    assert.deepEqual(validateMeasurementDiagnostics(value), { originalVerdict: verdict, numericBlocking: false });
  }
});

for (const verdict of ['fail', 'inconclusive']) {
  test(`measurement quality: ${verdict} -> still blocks despite numeric authorization`, () => {
    const value = { methodVersion: 'FA-V3', verdict, checks: [
      { reason: 'measurement-quality', verdict },
    ] };

    assert.throws(() => validateMeasurementDiagnostics(value), /quality\/authentication\/correctness/u);
  });
}

test('measurement Fluo error rate: positive warmup or measured rate -> blocking', () => {
  const value = { methodVersion: 'FA-V3', verdict: 'fail', checks: [
    { framework: 'fluo', metric: 'errorRate', reason: 'absolute-budget', verdict: 'fail', range: [0, 0.01] },
  ] };

  assert.throws(() => validateMeasurementDiagnostics(value), /zero/u);
});

test('measurement inventory: missing raw proof -> metadata cannot authenticate execution', () => {
  const value = { provenance: { commit: head }, receipts: ['desktop-native', 'desktop-matched-cache', 'tablet-native', 'tablet-matched-cache'].map((profile) => ({
    profile, methodVersion: 'FA-V3', measurementPurpose: 'integrated', isolatedRepresentative: true,
    provenance: { commit: head }, methodBinding: { path: 'original-method', sha256: '1'.repeat(64) },
    environmentBinding: { path: 'original-environment', sha256: '2'.repeat(64) },
    runs: [], warmups: [],
  })) };

  assert.throws(() => validateMeasurementInventory(value, new Map()), /original method\/environment/u);
});

function traceFixture(t) {
  const value = fixture(t);
  const live = { document: 'fixture-document', id: 'fixture-resource', actualInstanceRetained: true,
    mounts: 1, cleanups: 0, ports: 2, unhandled: 0, pendingInteractions: 0,
    pendingNavigation: false, harnessObservers: 0, globalListeners: 10, sockets: 0, interactionOwners: 5 };
  const checkpoint = { live, server: { requestScopes: 0, cleanupSubscriptions: 0 }, harness: { activeRequestReferences: 0 } };
  const events = [];
  const event = (phase, index, detail) => events.push({ phase, index, seed: 3886, detail });
  event('start', 0, { head, engine: 'chromium' });
  event('resource-ack', 0, { id: live.id, sequence: 1, acknowledgement: `${live.id}:1:ack` });
  for (const fault of ['network', 'server-error', 'slow', 'payload', 'import', 'render', 'deploy']) {
    event('fault-schedule', 0, { fault });
  }
  for (let index = 0; index < 1070; index++) {
    event('action-settled', index, 'fixture-action');
    event('resource-ack', index + 1, { id: live.id, sequence: index + 2,
      acknowledgement: `${live.id}:${index + 2}:ack` });
    if (index === 69) event('measurement', 70, { ...checkpoint, warmup: true });
  }
  event('measurement', 1070, { ...checkpoint, warmup: false });
  event('workload-complete', 1070, { index: 1070, elapsedMs: 3600001 });
  const receipt = { version: 1, issue: 3886, head, seed: 3886, engine: 'chromium', kind: 'soak',
    status: 'passed', firstFailure: null, actionCount: 1070, measuredActionCount: 1000,
    elapsedMs: 3600001, eventTrace: 'events.jsonl', surface: 'official-example-production' };
  const save = () => {
    const raw = Buffer.from(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    const bytes = Buffer.from(JSON.stringify(receipt));
    writeFileSync(join(value.root, 'events.jsonl'), raw);
    writeFileSync(join(value.root, 'receipt.json'), bytes);
    return { path: 'receipt.json', sha256: digest(bytes), trace: { path: 'events.jsonl', sha256: digest(raw) } };
  };
  return { ...value, events, receipt, save };
}

test('reliability trace: complete terminal/count/owner/ack inventory -> authenticated parsed run', async (t) => {
  const value = traceFixture(t);

  assert.deepEqual(await reliabilityRun(value.root, value.save(), head), value.receipt);
});

for (const defect of ['truncated', 'inflated-count', 'duration-mismatch', 'missing-fault', 'missing-ack', 'owner-leak', 'pageerror']) {
  test(`reliability trace: ${defect} -> no source-only stability PASS`, async (t) => {
    const value = traceFixture(t);
    if (defect === 'truncated') value.events.pop();
    if (defect === 'inflated-count') value.receipt.measuredActionCount++;
    if (defect === 'duration-mismatch') value.receipt.elapsedMs++;
    if (defect === 'missing-fault') value.events.splice(value.events.findIndex((event) => event.phase === 'fault-schedule'), 1);
    if (defect === 'missing-ack') value.events.splice(value.events.findIndex((event) => event.phase === 'resource-ack'), 1);
    if (defect === 'owner-leak') value.events.find((event) => event.phase === 'measurement').detail.live.cleanups = 1;
    if (defect === 'pageerror') value.events.splice(10, 0, { phase: 'pageerror', seed: 3886, index: 0, detail: 'fixture error' });

    await assert.rejects(reliabilityRun(value.root, value.save(), head));
  });
}

test('reliability inventory: missing engine or below one hour -> incomplete acceptance', () => {
  const runs = ['chromium', 'firefox', 'webkit'].map((engine) => ({ engine, kind: 'correctness' }));

  assert.throws(() => validateReliabilityInventory(runs.slice(0, 2), { kind: 'soak', elapsedMs: 3600001 }), /engine/u);
  assert.throws(() => validateReliabilityInventory(runs, { kind: 'soak', elapsedMs: 3599999 }), /one-hour/u);
  validateReliabilityInventory(runs, { kind: 'soak', elapsedMs: 3600001 });
});

test('CI capture plans: existing domain commands -> fresh separate builds and no invasive collectors', () => {
  const commands = ['tooling', 'starters', 'soak'].flatMap((domain) => productDomainPlan(domain, '/fixture'));
  const serialized = JSON.stringify(commands);

  assert.equal(serialized.includes('verify:local'), false);
  assert.equal(serialized.includes('Frida'), false);
  assert.equal(serialized.includes('frida'), false);
  assert.equal(commands.some((command) => command.id === 'packed-cold-dev'
    && command.args.includes('sandbox:matrix') && command.env.FLUO_CLI_SANDBOX_PROFILE === 'full'), true);
  assert.equal(commands.some((command) => command.id === 'soak-browser'
    && command.env.FLUO_RELIABILITY_SOAK_MS === '3600000'), true);
});

test('final product: absent lead review/waiver/remote evidence -> never final PASS', async (t) => {
  const value = fixture(t);
  value.receipt.stage = 'final';

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /external proof/u);
});
