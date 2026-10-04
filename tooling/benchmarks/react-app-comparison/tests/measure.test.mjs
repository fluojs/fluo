import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { METRICS as EVALUATOR_METRICS } from '../src/evaluate.ts';
import { collectDevMeasurements, collectMeasurements, environmentConfigIdentity, mergeEvidence, PROFILES,
  isolatedEnvironmentIdentity, planMeasurements, summarizeEnvironmentHeadroom,
  verifyEnvironmentBinding, verifyMeasurementEnvironment, verifyTraceFiles } from '../src/measure.mjs';
import { createBrowserDriver } from '../src/measure-browser.mjs';
import { evaluateEvidence } from '../src/gate.mjs';
import { createNativeLifetimeObserver, NATIVE_LIFETIME_IDENTITY, NATIVE_LIFETIME_METHOD,
  NATIVE_LIFETIME_RUNTIME, NATIVE_LIFETIME_SCHEMA, reconcileNativeLifetime } from '../src/native-lifetime.mjs';

const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
const config = {
  profile: 'desktop-matched-cache',
  mode: 'matched-cache',
  warmupRuns: 1,
  measurementRuns: 3,
  apps: Object.fromEntries(frameworks.map((framework) => [framework, `http://127.0.0.1/${framework}`])),
  provenance: { browser: 'Chromium pinned', runtime: 'Node pinned', builds: { fluo: 'build command' }, lockfile: 'sha256:abc', dataset: 'fixture-v1' },
};

test('isolated representative mode rejects missing live environment binding before driver work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    await assert.rejects(collectMeasurements({ ...config, isolatedRepresentative: true }, {
      async check() { assert.fail('unauthenticated invocation reached correctness'); },
    }, directory), /environment binding/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ordinary React edit capture does not require pinned history or production builds', async () => {
  const { captureReactEditSource } = await import('../src/measure.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'fluo-non-pair-source-'));
  const candidate = { provenance: { root: directory }, dev: { fluo: { edits: {
    'react-edit': { file: 'src/catalog-destination.tsx', reload: false, from: 'Editor login',
      to: 'Editor login changed', path: '/login', selector: 'h1', expectedText: 'Editor login changed' },
  } } } };
  try {
    // No historical Git objects, pinned source or production dist exists here.
    assert.equal(await captureReactEditSource(candidate), undefined);
    await assert.rejects(captureReactEditSource(candidate, { pairSource: true }), { code: 'ENOENT' });
    candidate.dev.fluo.edits['react-edit'].file = 'src/future-component.tsx';
    assert.equal(await captureReactEditSource(candidate), undefined);
    await assert.rejects(captureReactEditSource(candidate, { pairSource: true }), /source role mismatch/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const purpose of [undefined, 'native-conformance', 'timing']) {
const methodVersion = purpose ? 'FA-V2' : undefined;
test(`${methodVersion ? `FA-V2 ${purpose}` : 'historical replay'} source-bound React pair authenticates both records without equating full config hashes`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-react-pair-'));
  try {
    const methods = await import('../src/measure.mjs');
    assert.equal(typeof methods.authenticateReactEditPair, 'function');
    const edit = { file: 'src/document.ts', reload: true, from: 'Editor login',
      to: 'Editor login changed', path: '/login', selector: 'h1', expectedText: 'Editor login changed' };
    const beforeConfig = { ...config,
      ...(methodVersion ? { ...JSON.parse(await readFile(new URL('../config/representative.json', import.meta.url), 'utf8')).measurement,
        methodVersion, measurementPurpose: purpose, warmupRuns: 2, measurementRuns: 5,
        nativeLifetime: purpose === 'timing' ? { enabled: false } : { enabled: true, python: '/python' },
        pairId: 'source-bound-pair', pairPhase: 'before', measurementKind: 'development' } : {}),
      dev: { fluo: { edits: { 'react-edit': edit } } } };
    const afterConfig = structuredClone(beforeConfig);
    if (methodVersion) afterConfig.pairPhase = 'after';
    Object.assign(afterConfig.dev.fluo.edits['react-edit'], { file: 'src/catalog-destination.tsx', reload: false });
    const before = await environmentFixture(directory, 'before', beforeConfig);
    const after = await environmentFixture(directory, 'after', afterConfig);
    // No descriptor or pair hash can replace product/source evidence.
    await assert.rejects(methods.authenticateReactEditPair(before.binding, after.binding, directory),
      /source proof/u);
    assert.notEqual(before.binding.configSha256, after.binding.configSha256);
    await assert.rejects(methods.authenticateReactEditPair(after.binding, before.binding, directory),
      /direction|source proof|phase/u);
    const equal = await environmentFixture(directory, 'equal',
      { ...beforeConfig, ...(methodVersion ? { pairPhase: 'after' } : {}) });
    const equalRelation = await methods.authenticateReactEditPair(before.binding, equal.binding, directory);
    if (methodVersion) assert.equal(equalRelation.afterConfigSha256, equal.binding.configSha256);
    else assert.equal(equalRelation, null);
    // Preserve the authentic objects without requiring pre-squash Git history.
    const sources = JSON.parse(await readFile(new URL('./fixtures/react-edit-sources.json', import.meta.url), 'utf8'));
    const anchors = [
      ['before', '8a09eb8d216e555b97760a86539dea31e79c86a8', 'd1cab92d356721fce862456de5b492f15a225f0c', before],
      ['after', 'f9f5ac6722957cbe2752b9959e657a46594c0a1b', 'c5b7573e8da64237eecff459365e348b626285d9', after],
    ];
    const persist = async ({ record, binding }) => {
      const raw = JSON.stringify(record);
      await writeFile(binding.path, raw);
      binding.sha256 = createHash('sha256').update(raw).digest('hex');
    };
    for (const [role, head, blob, fixture] of anchors) {
      const { original, commit } = sources[role];
      fixture.record.reactEditSource = { schemaVersion: 1, role, anchor: head, head,
        root: '/product', path: `/product/tooling/benchmarks/react-app-comparison/apps/fluo/${role === 'before' ? edit.file : afterConfig.dev.fluo.edits['react-edit'].file}`,
        file: role === 'before' ? edit.file : afterConfig.dev.fluo.edits['react-edit'].file,
        originalBase64: Buffer.from(original).toString('base64'),
        originalSha256: createHash('sha256').update(original).digest('hex'), gitBlob: blob,
        dirtyPatch: '', dirtyPatchSha256: createHash('sha256').update('').digest('hex'),
        builds: { '/product/tooling/benchmarks/react-app-comparison/apps/fluo/dist/entry.js': {
          sha256: createHash('sha256').update('compiled fixture').digest('hex'),
          bytesBase64: Buffer.from('compiled fixture').toString('base64') } }, commits: { [head]: commit } };
      fixture.record.provenance = { ...config.provenance, root: '/product', commit: head };
      await persist(fixture);
    }
    await assert.doesNotReject(methods.authenticateReactEditPair(before.binding, after.binding, directory));
    const relation = await methods.authenticateReactEditPair(before.binding, after.binding, directory);
    assert.equal(relation.beforeConfigSha256, before.binding.configSha256);
    assert.equal(relation.afterConfigSha256, after.binding.configSha256);
    assert.notEqual(relation.beforeConfigSha256, relation.afterConfigSha256);
    await methods.verifyReactEditPairRelation(relation, after.binding, directory);
    await assert.rejects(methods.verifyReactEditPairRelation({ ...relation, beforeConfigSha256: after.binding.configSha256 },
      after.binding, directory), /replay mismatch/u);
    const flags = ['--environment-identity', before.binding.identitySha256,
      '--environment-config-identity', before.binding.configSha256,
      '--environment-before-record', before.binding.path, '--environment-before-root', directory];
    const imported = await methods.importEnvironmentPairBefore(flags, directory);
    assert.equal(await readFile(imported.path, 'utf8'), await readFile(before.binding.path, 'utf8'));
    after.record.pairBeforeBinding = imported;
    await persist(after);
    const originalAfterBytes = await readFile(after.binding.path, 'utf8');
    const bound = await methods.bindEnvironmentPair(after.binding, flags, directory);
    assert.equal(await readFile(after.binding.path, 'utf8'), originalAfterBytes);
    await methods.verifyReactEditPairRelation(bound, after.binding, directory);
    if (methodVersion) {
      const { captureMethodBinding } = await import('../src/fa-v2.mjs');
      const { verifyDevelopmentPairRelation } = await import('../src/gate.mjs');
      const baselineSha256 = createHash('sha256').update(await readFile(new URL('../baseline.json', import.meta.url))).digest('hex');
      const methodFor = (fixture) => captureMethodBinding({
        ...fixture.record.configurationEvidence,
        provenance: { ...fixture.record.provenance, baselineSha256 },
      }, directory);
      const firstReceipt = { developmentEnvironmentBinding: imported,
        developmentMethodBinding: await methodFor(before) };
      const secondReceipt = { developmentEnvironmentBinding: after.binding,
        developmentMethodBinding: await methodFor(after), developmentEnvironmentPairRelation: bound };
      assert.deepEqual(await verifyDevelopmentPairRelation(firstReceipt, secondReceipt, directory), bound);
      await assert.rejects(verifyDevelopmentPairRelation(firstReceipt,
        { ...secondReceipt, developmentEnvironmentPairRelation: undefined }, directory), /receipt source relation/u);
      await assert.rejects(verifyDevelopmentPairRelation(firstReceipt, {
        ...secondReceipt, developmentEnvironmentPairRelation: {
          ...bound, afterSource: { ...bound.afterSource, originalSha256: 'b'.repeat(64) },
        },
      }, directory), /receipt source relation/u);
      await assert.rejects(verifyDevelopmentPairRelation(secondReceipt, firstReceipt, directory),
        /development method/u);
    }
    const receipt = { profile: config.profile, mode: config.mode, provenance: after.record.provenance,
      isolatedRepresentative: true, environmentBinding: after.binding, runs: [], warmups: [] };
    await assert.rejects(verifyMeasurementEnvironment(receipt, directory), /relation missing/u);
    await verifyMeasurementEnvironment({ ...receipt, environmentPairRelation: bound }, directory);
    delete after.record.pairBeforeBinding;
    await persist(after);
    const good = structuredClone(after.record);
    for (const mutate of [
      ...(methodVersion ? [
        (record) => { record.configuration.pairPhase = 'before'; },
        (record) => { record.configuration.pairPhase = 'unknown'; },
        (record) => { record.configuration.pairId = 'unrelated-pair'; },
        (record) => { record.configuration.methodVersion = 'historical-v1'; },
        (record) => { record.configuration.measurementPurpose = purpose === 'timing' ? 'native-conformance' : 'timing'; },
        (record) => { record.configuration.measurementKind = 'production'; },
      ] : []),
      (record) => { record.configuration.dev.fluo.edits['react-edit'].reload = true; },
      (record) => { record.configuration.dev.fluo.edits['react-edit'].file = 'src/unrelated.tsx'; },
      ...['from', 'to', 'path', 'selector', 'expectedText'].map((key) => (record) => {
        record.configuration.dev.fluo.edits['react-edit'][key] = 'other';
      }),
      ...['restartPattern', 'explicitReload', 'relaunch', 'command'].map((key) => (record) => {
        record.configuration.dev.fluo.edits['react-edit'][key] = true;
      }),
      (record) => { delete record.configuration.dev.fluo.edits['react-edit'].selector; },
      (record) => { record.configuration.dev.next = { edits: {} }; },
      (record) => { record.configuration.measurementRuns += 1; },
      (record) => { record.configuration.mode = 'native'; },
      (record) => { record.configuration.profile = 'tablet-matched-cache'; },
      (record) => { record.configuration.extra = 1; },
      (record) => { record.configuration.throughput = { fluo: { requests: 9 } }; },
      (record) => { record.configuration.dev.fluo.readiness = { protocol: 'next-webpack', path: '/' }; },
      (record) => { record.configuration.dev.fluo.start = ['different-command']; },
      (record) => { record.configuration.cpuSlowdown = 2; },
      (record) => { record.configuration.network = { latencyMs: 1 }; },
      (record) => { record.configuration.budget = 999; },
      (record) => { record.configuration.cache = 'other'; },
    ]) {
      after.record = structuredClone(good);
      mutate(after.record);
      after.record.configurationEvidence = structuredClone(after.record.configuration);
      if (after.record.configuration.nativeLifetime.python) {
        after.record.configurationEvidence.nativeLifetime.python = '/python';
      }
      after.record.configSha256 = environmentConfigIdentity(after.record.configurationEvidence);
      after.binding.configSha256 = after.record.configSha256;
      await persist(after);
      await assert.rejects(methods.authenticateReactEditPair(before.binding, after.binding, directory),
        /direction|other configuration|unsupported runtime\/browser\/observer/u);
    }
    after.record = structuredClone(good);
    after.binding.configSha256 = good.configSha256;
    const guest = after.record.guestEvidence.guest;
    guest.files[guest.collector['initial-readiness.mjs'].path] = 'b'.repeat(64);
    guest.collector['initial-readiness.mjs'].sha256 = 'b'.repeat(64);
    after.record.identity = isolatedEnvironmentIdentity(after.record.invocation.host, guest);
    after.record.identitySha256 = createHash('sha256').update(JSON.stringify(after.record.identity)).digest('hex');
    after.binding.identitySha256 = after.record.identitySha256;
    await persist(after);
    await assert.rejects(methods.authenticateReactEditPair(before.binding, after.binding, directory), /environment mismatch/u);
    after.record = structuredClone(good);
    after.binding.identitySha256 = good.identitySha256;
    for (const mutate of [
      (proof) => { proof.head = '1'.repeat(40); },
      (proof) => { proof.root = '/unrelated-root'; },
      (proof) => { proof.path = '/outside/source.tsx'; },
      (proof) => { Object.values(proof.builds)[0].bytesBase64 = Buffer.from('tampered build').toString('base64'); },
      (proof) => { Object.values(proof.builds)[0].sha256 = 'b'.repeat(64); },
      (proof) => { proof.originalBase64 = Buffer.from('wrong product source').toString('base64'); },
      (proof) => { proof.originalSha256 = 'b'.repeat(64); },
    ]) {
      after.record = structuredClone(good);
      mutate(after.record.reactEditSource);
      await persist(after);
      await assert.rejects(methods.authenticateReactEditPair(before.binding, after.binding, directory), /source proof/u);
    }
    after.record = structuredClone(good);
    await persist(after);
    const originalHash = after.binding.configSha256;
    after.record.configurationEvidence.dev.fluo.edits['react-edit'].reload = true;
    await persist(after);
    await assert.rejects(methods.authenticateReactEditPair(before.binding, after.binding, directory), /identity\/invocation/u);
    assert.equal(after.binding.configSha256, originalHash);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
}

test('a configured hot-update label without actual React edit proof is inconclusive, not a metric', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-react-edit-label-'));
  try {
    const result = await collectDevMeasurements({ ...config, measurementRuns: 1, warmupRuns: 0,
      dev: { fluo: { edits: { 'react-edit': { file: 'src/catalog-destination.tsx', reload: false,
        from: 'Editor login', to: 'Editor login changed', path: '/login', selector: 'h1',
        expectedText: 'Editor login changed' } } } },
    }, {
      async check() { return { pass: true, steps: [] }; },
      async measureDev(_item, _config, kind) { return { durationMs: 1, event: `${kind}-visible`, method: 'hot-update' }; },
    }, directory);
    const fluo = result.runs.find((run) => run.framework === 'fluo');
    assert.equal(fluo.correctness, 'inconclusive');
    assert.equal(Object.hasOwn(fluo.metrics, 'devReactEditVisibleMs'), false);
    const raw = JSON.parse(await readFile(fluo.trace, 'utf8'));
    assert.equal(raw.timings['react-edit'].method, 'hot-update');
    assert.ok(raw.unavailable.devReactEditVisibleMs);
    assert.equal(raw.qualityFailures.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const purpose of ['timing', 'native-conformance']) {
test(`FA-V2 ${purpose} production phase transition retains exact stimuli and original before binding`, async (t) => {
  const methods = await import('../src/measure.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'fluo-phase-only-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const beforeConfig = { ...config, methodVersion: 'FA-V2', measurementPurpose: purpose,
    pairId: 'phase-only', pairPhase: 'before', measurementKind: 'production',
    nativeLifetime: purpose === 'timing' ? { enabled: false } : { enabled: true, python: '/python' } };
  const before = await environmentFixture(directory, 'before', beforeConfig);
  const after = await environmentFixture(directory, 'after', { ...beforeConfig, pairPhase: 'after' });
  const relation = await methods.authenticateReactEditPair(before.binding, after.binding, directory);
  assert.notEqual(relation.beforeConfigSha256, relation.afterConfigSha256);
  assert.equal(Object.hasOwn(relation, 'beforeSource'), false);
  await methods.verifyReactEditPairRelation(JSON.parse(JSON.stringify(relation)), after.binding, directory);
  const persist = async (fixture) => {
    const bytes = JSON.stringify(fixture.record);
    await writeFile(fixture.binding.path, bytes);
    fixture.binding.sha256 = createHash('sha256').update(bytes).digest('hex');
  };
  after.record.pairBeforeBinding = before.binding;
  await persist(after);
  const bound = await methods.authenticateReactEditPair(before.binding, after.binding, directory);
  await methods.verifyReactEditPairRelation(bound, after.binding, directory);
  const alias = await environmentFixture(directory, 'different-before', beforeConfig);
  const aliasRelation = await methods.authenticateReactEditPair(alias.binding, after.binding, directory);
  await assert.rejects(methods.verifyReactEditPairRelation(aliasRelation, after.binding, directory),
    /original before binding/u);
  const good = structuredClone(after.record);
  for (const change of [
    { pairPhase: 'before' }, { pairPhase: 'unknown' }, { pairId: 'another-pair' },
    { methodVersion: 'historical-v1' }, { extra: true },
    { dev: { fluo: { edits: { 'react-edit': { file: 'src/catalog-destination.tsx', reload: false } } } } },
  ]) {
    after.record = structuredClone(good);
    delete after.record.pairBeforeBinding;
    Object.assign(after.record.configuration, change);
    after.record.configurationEvidence = structuredClone(after.record.configuration);
    if (after.record.configuration.nativeLifetime.python) after.record.configurationEvidence.nativeLifetime.python = '/python';
    after.record.configSha256 = environmentConfigIdentity(after.record.configurationEvidence);
    after.binding.configSha256 = after.record.configSha256;
    await persist(after);
    await assert.rejects(methods.authenticateReactEditPair(before.binding, after.binding, directory),
      /other configuration|unsupported runtime\/browser\/observer/u);
  }
});
}

test('isolated replay rejects absent bindings on samples and combined sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: [] }; },
      async measure() { return { metrics: { coldTtfbMs: 1 } }; },
    }, directory);
    const run = result.runs[0];
    const trace = JSON.parse(await readFile(run.trace, 'utf8'));
    trace.isolatedRepresentative = true;
    await writeFile(run.trace, JSON.stringify(trace));
    await assert.rejects(verifyTraceFiles([run], directory), /environment binding/u);
    const combined = join(directory, 'combined.json');
    await writeFile(combined, JSON.stringify({ schemaVersion: 1, isolatedRepresentative: true,
      correctness: {}, sourceTraces: [run.trace, result.runs[1].trace] }));
    await assert.rejects(verifyTraceFiles([{ trace: combined }], directory), /environment binding/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('isolated production and development aggregates cannot merge mismatched environments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  const run = { framework: 'fluo', runId: 'r-1', trace: '/not-read', metrics: {}, correctness: 'pass' };
  try {
    await assert.rejects(mergeEvidence({
      isolatedRepresentative: true, environmentBinding: { identitySha256: 'before' }, runs: [run],
    }, {
      isolatedRepresentative: true, environmentBinding: { identitySha256: 'other' }, runs: [run],
    }, directory), /environment binding/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function environmentFixture(directory, invocationId = 'invocation', measurementConfig = config) {
  const allocation = { nanoCpus: 0, cpuQuota: 0, cpuPeriod: 0, cpuset: '', memory: 0, memorySwap: 0 };
  const vm = { kernel: 'kernel', logicalCpus: 12, memoryBytes: 8392974336 };
  const container = { id: 'container', imageId: 'image', imageReference: 'fixture', hostname: 'guest',
    pid: 99, startedAt: 'start', allocation };
  const raw = { inspection: JSON.stringify([{ Id: container.id, Image: container.imageId,
    Config: { Image: container.imageReference, Hostname: container.hostname },
    State: { Running: true, Pid: container.pid, StartedAt: container.startedAt },
    HostConfig: { NanoCpus: 0, CpuQuota: 0, CpuPeriod: 0, CpusetCpus: '', Memory: 0, MemorySwap: 0 } }]),
    information: JSON.stringify({ KernelVersion: vm.kernel, NCPU: vm.logicalCpus, MemTotal: vm.memoryBytes }) };
  const configuration = { ...measurementConfig,
    nativeLifetime: measurementConfig.nativeLifetime ?? { enabled: true, python: '/python' } };
  delete configuration.provenance;
  const identity = { vm, container: { imageId: container.imageId, imageReference: container.imageReference, allocation },
    guest: { platform: 'linux', arch: 'arm64', kernel: vm.kernel, logicalCpus: vm.logicalCpus,
      memoryBytes: vm.memoryBytes, runtime: { version: 'v24.21.0' },
      browser: { version: NATIVE_LIFETIME_IDENTITY.browserVersion, sha256: NATIVE_LIFETIME_IDENTITY.binarySha256 },
      external: NATIVE_LIFETIME_RUNTIME, files: {},
      observer: { enabled: true, method: NATIVE_LIFETIME_METHOD, schema: NATIVE_LIFETIME_SCHEMA } } };
  const guest = identity.guest;
  const file = (path, sha256 = 'a'.repeat(64)) => {
    guest.files[path] = sha256;
    return { path, sha256 };
  };
  guest.runtime.node = file('/node');
  guest.browser.path = '/headless_shell';
  guest.files[guest.browser.path] = guest.browser.sha256;
  guest.python = file('/python', NATIVE_LIFETIME_RUNTIME.pythonSha256);
  guest.pnpm = { ...file('/pnpm'), version: '10.4.1' };
  guest.sdk = Object.fromEntries(['@playwright/test', 'playwright', 'playwright-core', 'typescript']
    .map((name) => [name, { ...file(`/${name}/package.json`), version: name === 'typescript' ? '6.0.2' : '1.61.1' }]));
  guest.collector = Object.fromEntries(['measure.mjs', 'measure-browser.mjs', 'run-gate.mjs',
    'native-terminal.mjs', 'native-lifetime.mjs', 'native-lifetime-agent.js', 'native-lifetime-host.py',
    'initial-readiness.mjs', 'process-group.mjs', 'gate.mjs', 'evaluate.ts', 'fluo-dev.mjs',
    'fa-v2.mjs', 'server-cpu.mjs']
    .map((name) => [name, file(`/collector/${name}`)]));
  guest.collectorEntrypoints = ['measure.mjs', 'run-gate.mjs'];
  guest.locks = Object.fromEntries(['.', ...frameworks.map((name) => `apps/${name}`)]
    .map((name) => [name, file(`/locks/${name}/pnpm-lock.yaml`)]));
  guest.allocation = { 'cpu.max': 'max 100000', 'cpuset.cpus.effective': '0-11', 'memory.max': 'max' };
  if (measurementConfig.methodVersion === 'FA-V2' && measurementConfig.measurementPurpose === 'timing') {
    delete guest.python;
    delete guest.external;
    delete guest.files['/python'];
    guest.observer.enabled = false;
  }
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const host = { host: { platform: 'darwin', arch: 'arm64', cpuModel: 'Apple M4 Pro' }, vm, container, raw };
  const comparable = isolatedEnvironmentIdentity(host, guest);
  const comparableConfig = { ...configuration, nativeLifetime: {
    ...configuration.nativeLifetime,
    ...(configuration.nativeLifetime.python ? { python: '$authenticated-python' } : {}),
  } };
  const record = { schemaVersion: 1, method: 'isolated-linux-representative-v1',
    invocation: { invocationId, host }, identity: comparable, configuration: comparableConfig,
    configurationEvidence: configuration, provenance: config.provenance,
    identitySha256: hash(comparable), configSha256: environmentConfigIdentity(configuration),
    guestEvidence: { pid: 1, hostname: 'guest', guest } };
  const path = join(directory, `environment-${invocationId}.json`);
  const bytes = JSON.stringify(record);
  await writeFile(path, bytes);
  return { record, binding: { method: record.method, path,
    sha256: createHash('sha256').update(bytes).digest('hex'), invocationId,
    identitySha256: record.identitySha256, configSha256: record.configSha256 } };
}

test('actual helper-only source drift changes pair identity and missing helpers fail capture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-collector-'));
  try {
    const { captureCollectorSources, requireEnvironmentPairIdentity } = await import('../src/measure.mjs');
    assert.equal(typeof captureCollectorSources, 'function');
    await cp(new URL('../src/', import.meta.url), directory, { recursive: true });
    const before = await captureCollectorSources(directory);
    const helper = join(directory, 'initial-readiness.mjs');
    await writeFile(helper, `${await readFile(helper, 'utf8')}\n// helper-only drift\n`);
    const after = await captureCollectorSources(directory);
    const host = { container: {} };
    const hash = (collector) => createHash('sha256').update(JSON.stringify(
      isolatedEnvironmentIdentity(host, { collector, files: {} }))).digest('hex');
    const binding = { identitySha256: hash(before), configSha256: 'unchanged-config' };
    await assert.rejects(async () => requireEnvironmentPairIdentity(
      { ...binding, identitySha256: hash(after) }, ['--environment-identity', binding.identitySha256,
        '--environment-config-identity', binding.configSha256]), /environment\/config mismatch/u);
    await rm(helper);
    await assert.rejects(captureCollectorSources(directory), { code: 'ENOENT' });
    await cp(new URL('../src/initial-readiness.mjs', import.meta.url), helper);
    await rm(join(directory, 'server-measurement.mjs'), { force: true });
    await assert.rejects(captureCollectorSources(directory, ['run-server-only.mjs']), { code: 'ENOENT' });
    for (const name of ['run-server-only.mjs', 'server-measurement.mjs', 'socket-shell.mjs']) {
      await writeFile(join(directory, name), 'export const value = 1;\n');
    }
    const serverBefore = await captureCollectorSources(directory, ['run-server-only.mjs']);
    await writeFile(join(directory, 'socket-shell.mjs'), 'export const value = 2;\n');
    const serverAfter = await captureCollectorSources(directory, ['run-server-only.mjs']);
    assert.notEqual(hash(serverBefore), hash(serverAfter));
    await rm(join(directory, 'server-measurement.mjs'));
    await assert.rejects(captureCollectorSources(directory, ['run-server-only.mjs']), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('authenticated replay rejects each missing measurement-driving helper', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    for (const name of ['initial-readiness.mjs', 'process-group.mjs', 'gate.mjs', 'evaluate.ts', 'fluo-dev.mjs']) {
      const { record, binding } = await environmentFixture(directory);
      const guest = record.guestEvidence.guest;
      delete guest.files[guest.collector[name].path];
      delete guest.collector[name];
      record.identity = isolatedEnvironmentIdentity(record.invocation.host, guest);
      record.identitySha256 = createHash('sha256').update(JSON.stringify(record.identity)).digest('hex');
      const bytes = JSON.stringify(record);
      await writeFile(binding.path, bytes);
      await assert.rejects(verifyEnvironmentBinding({ ...binding, identitySha256: record.identitySha256,
        sha256: createHash('sha256').update(bytes).digest('hex') }, directory),
      /incomplete executable\/SDK\/collector\/allocation/u, name);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('producer keeps distinct authenticated invocation bindings out of strict product provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    const combinedReceipts = [];
    for (const profile of [config.profile, 'tablet-matched-cache']) {
      const receipts = [];
      for (const mode of ['production', 'development']) {
        const name = `${profile}-${mode}`;
        const { binding } = await environmentFixture(directory, name, { ...config, profile });
        const receipt = await collectMeasurements({ ...config, profile,
          provenance: { ...config.provenance, isolatedRepresentative: true, environmentBinding: binding },
        }, { async check() { return { pass: false, steps: [] }; } }, join(directory, name));
        Object.assign(receipt, { isolatedRepresentative: true, environmentBinding: binding });
        for (const run of [...receipt.runs, ...receipt.warmups]) {
          Object.assign(run, { isolatedRepresentative: true, environmentBinding: binding });
          const raw = JSON.parse(await readFile(run.trace, 'utf8'));
          Object.assign(raw, { isolatedRepresentative: true, environmentBinding: binding });
          raw.environment.browserVersion = NATIVE_LIFETIME_IDENTITY.browserVersion;
          await writeFile(run.trace, JSON.stringify(raw));
        }
        receipts.push(receipt);
      }
      const combined = await mergeEvidence(...receipts, join(directory, 'combined'));
      combinedReceipts.push(combined);
      await verifyTraceFiles([...combined.runs, ...combined.warmups, ...combined.developmentWarmups], directory);
      assert.deepEqual(receipts[0].provenance, config.provenance);
      assert.deepEqual(receipts[1].provenance, config.provenance);
      await assert.rejects(verifyMeasurementEnvironment({ ...combined, mode: 'native' }, directory),
        /configuration mismatch/u);
      await assert.rejects(verifyMeasurementEnvironment({ ...combined, isolatedRepresentative: false,
        environmentBinding: undefined }, directory), /aggregate mode/u);
      await assert.rejects(verifyMeasurementEnvironment({ ...combined,
        environmentBinding: { ...combined.environmentBinding, method: 'forged' } }, directory), /environment binding/u);
    }
    const baseline = { profiles: Object.fromEntries([config.profile, 'tablet-matched-cache'].map((profile) => [profile, {
      mode: config.mode, absoluteBudgets: Object.fromEntries(EVALUATOR_METRICS.map((metric) => [metric, 100])),
      relativeBands: Object.fromEntries(EVALUATOR_METRICS.map((metric) => [metric, 1.5])),
    }])), policy: { minimumRuns: 3, warmupRuns: 1, maximumRelativeSpread: 0.1, outlierMadMultiplier: 3 } };
    await evaluateEvidence(baseline, combinedReceipts, directory);
    const combinedTrace = JSON.parse(await readFile(combinedReceipts[0].runs[0].trace, 'utf8'));
    const path = combinedTrace.sourceTraces[1];
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.provenance.commit = 'different-product';
    await writeFile(path, JSON.stringify(raw));
    await assert.rejects(evaluateEvidence(baseline, combinedReceipts, directory), /provenance/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('environment replay rejects tampered bytes, escaped records, invocation reuse and raw host mismatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    const { binding, record } = await environmentFixture(directory);
    await verifyEnvironmentBinding(binding, directory);
    await assert.rejects(verifyEnvironmentBinding({ ...binding, invocationId: 'another' }, directory), /invocation mismatch/u);
    await assert.rejects(verifyEnvironmentBinding(binding, join(directory, 'absent')), /ENOENT/u);
    await writeFile(binding.path, '{}');
    await assert.rejects(verifyEnvironmentBinding(binding, directory), /digest mismatch/u);
    record.invocation.host.container.pid = 100;
    const bytes = JSON.stringify(record);
    await writeFile(binding.path, bytes);
    await assert.rejects(verifyEnvironmentBinding({
      ...binding, sha256: createHash('sha256').update(bytes).digest('hex'),
    }, directory), /raw host\/guest observation mismatch/u);
    const sibling = await mkdtemp(join(tmpdir(), 'fluo-environment-outside-'));
    try {
      await assert.rejects(verifyEnvironmentBinding(binding, sibling), /outside output root/u);
    } finally { await rm(sibling, { recursive: true, force: true }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('environment replay rejects missing executable SDK collector and allocation identities even with a fresh digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    for (const key of ['sdk', 'collector', 'allocation', 'locks', 'python', 'pnpm']) {
      const { record, binding } = await environmentFixture(directory);
      delete record.guestEvidence.guest[key];
      record.identity = isolatedEnvironmentIdentity(record.invocation.host, record.guestEvidence.guest);
      record.identitySha256 = createHash('sha256').update(JSON.stringify(record.identity)).digest('hex');
      const raw = JSON.stringify(record);
      await writeFile(binding.path, raw);
      await assert.rejects(verifyEnvironmentBinding({
        ...binding, identitySha256: record.identitySha256,
        sha256: createHash('sha256').update(raw).digest('hex'),
      }, directory), /incomplete executable\/SDK\/collector\/allocation/u);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('environment identity excludes run-specific provenance and server PIDs but freezes profile/cache config', () => {
  assert.equal(environmentConfigIdentity(config), environmentConfigIdentity({
    ...config, provenance: { commit: 'after' }, serverPids: { fluo: 999 },
    isolatedRepresentative: true, environmentBinding: { invocationId: 'new' },
  }));
  assert.notEqual(environmentConfigIdentity(config), environmentConfigIdentity({ ...config, mode: 'native' }));
  assert.notEqual(environmentConfigIdentity(config), environmentConfigIdentity({
    ...config, environmentPairRelation: { alias: 'caller-supplied' },
  }));
});

test('before and after environment/config identities remain comparable across relocated product roots', async () => {
  const beforeConfig = { ...config, nativeLifetime: { enabled: true, python: '/before/observer/bin/python' },
    provenance: { ...config.provenance, root: '/before', commit: 'before-product', builds: { fluo: '/before/build' } },
    dev: { fluo: { cwd: '/before/apps/fluo', start: ['node', '/before/apps/fluo/server.mjs'],
      edits: { 'react-edit': { file: 'src/login.tsx', from: 'before', to: 'after' } } } } };
  const afterConfig = { ...beforeConfig, nativeLifetime: { enabled: true, python: '/after/observer/bin/python' },
    provenance: { ...beforeConfig.provenance, root: '/after', commit: 'after-product', builds: { fluo: '/after/build' } },
    dev: { fluo: { ...beforeConfig.dev.fluo, cwd: '/after/apps/fluo', start: ['node', '/after/apps/fluo/server.mjs'] } } };
  assert.equal(environmentConfigIdentity(beforeConfig), environmentConfigIdentity(afterConfig));
  assert.notEqual(environmentConfigIdentity(beforeConfig), environmentConfigIdentity({ ...afterConfig, measurementRuns: 4 }));
  const { isolatedEnvironmentIdentity } = await import('../src/measure.mjs');
  const guest = { runtime: { version: 'v24.21.0', node: { path: '/before/node', sha256: 'node-content' } },
    collector: { 'measure.mjs': { path: '/before/collector/measure.mjs', sha256: 'collector-content' } },
    locks: { '.': { path: '/before/lock.yaml', sha256: 'lock-content' } },
    files: { '/before/node': 'node-content' }, allocation: { 'cpu.max': 'max 100000' } };
  const host = { host: { cpuModel: 'Apple M4 Pro' }, vm: { daemonId: 'same-vm' },
    container: { id: 'before', pid: 1, hostname: 'before', startedAt: 'before',
      imageId: 'same-image', allocation: { nanoCpus: 0 } } };
  const relocatedGuest = JSON.parse(JSON.stringify(guest).replaceAll('/before/', '/after/'));
  const relocatedHost = { ...host, container: { ...host.container, id: 'after', pid: 2, hostname: 'after', startedAt: 'after' } };
  assert.deepEqual(isolatedEnvironmentIdentity(host, guest), isolatedEnvironmentIdentity(relocatedHost, relocatedGuest));
  const executableMismatch = structuredClone(relocatedGuest);
  executableMismatch.runtime.node.sha256 = 'different-executable';
  assert.notDeepEqual(isolatedEnvironmentIdentity(host, guest), isolatedEnvironmentIdentity(relocatedHost, executableMismatch));
  const allocationMismatch = structuredClone(relocatedHost);
  allocationMismatch.container.allocation.nanoCpus = 2_000_000_000;
  assert.notDeepEqual(isolatedEnvironmentIdentity(host, guest), isolatedEnvironmentIdentity(allocationMismatch, relocatedGuest));
  const { requireEnvironmentPairIdentity } = await import('../src/measure.mjs');
  const binding = { identitySha256: 'same-tools-allocation', configSha256: environmentConfigIdentity(beforeConfig) };
  const pairFlags = ['--environment-identity', binding.identitySha256,
    '--environment-config-identity', binding.configSha256];
  requireEnvironmentPairIdentity({ ...binding, configSha256: environmentConfigIdentity(afterConfig) }, pairFlags);
  assert.throws(() => requireEnvironmentPairIdentity({
    ...binding, configSha256: environmentConfigIdentity({ ...afterConfig, mode: 'native' }),
  }, pairFlags), /before\/after environment\/config mismatch/u);
  assert.throws(() => requireEnvironmentPairIdentity({ ...binding, identitySha256: 'different-tools' }, pairFlags),
    /before\/after environment\/config mismatch/u);
  assert.throws(() => requireEnvironmentPairIdentity(binding, pairFlags.slice(0, 2)),
    /requires both environment\/config identities/u);
});

test('isolated aggregate and combined replay preserve both invocations and all warmups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-environment-'));
  try {
    const { binding } = await environmentFixture(directory);
    const { binding: devBinding } = await environmentFixture(directory, 'development');
    const collect = async (name, environmentBinding) => {
      const receipt = await collectMeasurements(config, {
        async check() { return { pass: false, steps: [] }; },
      }, join(directory, name));
      receipt.isolatedRepresentative = true;
      receipt.environmentBinding = environmentBinding;
      for (const run of [...receipt.runs, ...receipt.warmups]) {
        Object.assign(run, { isolatedRepresentative: true, environmentBinding });
        const raw = JSON.parse(await readFile(run.trace, 'utf8'));
        Object.assign(raw, { isolatedRepresentative: true, environmentBinding, provenance: receipt.provenance });
        raw.environment.browserVersion = NATIVE_LIFETIME_IDENTITY.browserVersion;
        await writeFile(run.trace, JSON.stringify(raw));
      }
      return receipt;
    };
    const production = await collect('production', binding);
    const development = await collect('development', devBinding);
    const combined = await mergeEvidence(production, development, join(directory, 'combined'));
    assert.equal(combined.warmups.length, 4);
    assert.equal(combined.developmentWarmups.length, 4);
    assert.deepEqual(combined.developmentEnvironmentBinding, devBinding);
    await verifyMeasurementEnvironment(combined, directory);
    await verifyTraceFiles([...combined.runs, ...combined.warmups, ...combined.developmentWarmups], directory);
    const raw = JSON.parse(await readFile(combined.runs[0].trace, 'utf8'));
    assert.deepEqual(raw.sourceEnvironmentBindings, [binding, devBinding]);
    raw.sourceEnvironmentBindings[1] = binding;
    await writeFile(combined.runs[0].trace, JSON.stringify(raw));
    await assert.rejects(verifyTraceFiles(combined.runs, directory), /combined source mismatch/u);
    combined.warmups[0].environmentBinding = devBinding;
    await assert.rejects(verifyMeasurementEnvironment(combined, directory), /sample\/aggregate mismatch/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('four profile production and dev children retain distinct exact hashes and authenticated parents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-profile-pair-'));
  const { beforeProfilePairFlags, verifyProfileEnvironment } = await import('../src/run-gate.mjs');
  try {
    const { binding: aggregateBinding } = await environmentFixture(directory, 'aggregate');
    for (const profile of ['desktop-native', 'desktop-matched-cache', 'tablet-native', 'tablet-matched-cache']) {
      const bindings = [];
      for (const development of [false, true]) {
        const mode = profile.endsWith('matched-cache') ? 'matched-cache' : 'native';
        const measurement = { ...config, profile, mode, nativeLifetime: { enabled: true, python: '/python' },
          ...(development ? { dev: { fluo: { edits: {} } } } : {}) };
        const id = `aggregate-${profile}-${development ? 'development' : 'production'}`;
        const fixture = await environmentFixture(directory, id, measurement);
        fixture.record.invocation.parentInvocationId = aggregateBinding.invocationId;
        const raw = JSON.stringify(fixture.record);
        await writeFile(fixture.binding.path, raw);
        fixture.binding.sha256 = createHash('sha256').update(raw).digest('hex');
        const receipt = { schemaVersion: 1, profile, mode, provenance: config.provenance,
          isolatedRepresentative: true, environmentBinding: fixture.binding, runs: [], warmups: [] };
        await verifyProfileEnvironment(aggregateBinding, receipt, measurement, directory, development);
        const flags = await beforeProfilePairFlags(aggregateBinding.path, directory, profile, development);
        assert.equal(flags[flags.indexOf('--environment-config-identity') + 1], fixture.binding.configSha256);
        assert.equal(flags[flags.indexOf('--environment-before-record') + 1], fixture.binding.path);
        await assert.rejects(verifyProfileEnvironment(aggregateBinding, receipt,
          { ...measurement, measurementRuns: measurement.measurementRuns + 1 }, directory, development),
        /configuration\/invocation mismatch/u);
        fixture.record.invocation.parentInvocationId = 'other-parent';
        const changed = JSON.stringify(fixture.record);
        await writeFile(fixture.binding.path, changed);
        fixture.binding.sha256 = createHash('sha256').update(changed).digest('hex');
        await assert.rejects(verifyProfileEnvironment(aggregateBinding, receipt, measurement, directory, development),
          /configuration\/invocation mismatch/u);
        bindings.push(fixture.binding);
      }
      assert.notEqual(bindings[0].configSha256, bindings[1].configSha256);
      assert.notEqual(bindings[0].invocationId, bindings[1].invocationId);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('isolated raw traces reject removal of all aggregate sample and warmup markers', async (t) => {
  // Given: valid isolated production/development receipts, raw sources unchanged.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-full-downgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const receipts = [];
  for (const name of ['production', 'development']) {
    const { binding } = await environmentFixture(directory, name);
    const receipt = await collectMeasurements(config, {
      async check() { return { pass: false, steps: [] }; },
    }, join(directory, name));
    Object.assign(receipt, { isolatedRepresentative: true, environmentBinding: binding });
    for (const run of [...receipt.runs, ...receipt.warmups]) {
      Object.assign(run, { isolatedRepresentative: true, environmentBinding: binding });
      const raw = JSON.parse(await readFile(run.trace, 'utf8'));
      Object.assign(raw, { isolatedRepresentative: true, environmentBinding: binding });
      raw.environment.browserVersion = NATIVE_LIFETIME_IDENTITY.browserVersion;
      await writeFile(run.trace, JSON.stringify(raw));
    }
    receipts.push(receipt);
  }
  const combined = await mergeEvidence(...receipts, join(directory, 'combined'));
  await verifyMeasurementEnvironment(combined, directory);
  const samples = [...combined.runs, ...combined.warmups, ...combined.developmentWarmups];
  await verifyTraceFiles(samples, directory);
  const before = await Promise.all(samples.map((run) => readFile(run.trace)));
  // When: every summary declaration is removed, not only the aggregate marker.
  delete combined.isolatedRepresentative;
  delete combined.environmentBinding;
  delete combined.developmentEnvironmentBinding;
  for (const run of samples) {
    delete run.isolatedRepresentative;
    delete run.environmentBinding;
  }
  // Then: both public replay boundaries independently reject the downgrade.
  await t.test('aggregate verifier', async () => {
    await assert.rejects(verifyMeasurementEnvironment(combined, directory), /environment binding/u);
  });
  await t.test('trace verifier', async () => {
    await assert.rejects(verifyTraceFiles(samples, directory), /environment binding/u);
  });
  assert.deepEqual(await Promise.all(samples.map((run) => readFile(run.trace))), before);
});

test('default combined wrappers cannot conceal isolated raw sources', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-combined-downgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { binding } = await environmentFixture(directory);
  const receipt = await collectMeasurements(config, { async check() { return { pass: false }; } }, directory);
  const source = receipt.runs[0].trace;
  const raw = JSON.parse(await readFile(source, 'utf8'));
  Object.assign(raw, { isolatedRepresentative: true, environmentBinding: binding });
  raw.environment.browserVersion = NATIVE_LIFETIME_IDENTITY.browserVersion;
  await writeFile(source, JSON.stringify(raw));
  const trace = join(directory, 'combined.json');
  await writeFile(trace, JSON.stringify({ schemaVersion: 1, correctness: {},
    sourceTraces: [source, receipt.runs[1].trace] }));
  await assert.rejects(verifyTraceFiles([{ trace }], directory), /environment binding/u);
});

test('passive headroom retains CPU counters without replacing CPU or RSS metric definitions', () => {
  const before = { monotonicMs: 10, processCpu: { user: 100, system: 100 },
    cpus: [{ user: 10, nice: 0, sys: 10, idle: 80, irq: 0 }], memoryBytes: 1000 };
  const after = { monotonicMs: 110, processCpu: { user: 20100, system: 10100 },
    cpus: [{ user: 20, nice: 0, sys: 20, idle: 160, irq: 0 }], memoryBytes: 2000 };
  const result = summarizeEnvironmentHeadroom(before, after);
  assert.equal(result.generatorCpuPercent, 30);
  assert.equal(result.ambientBusyPercent, 20);
  assert.equal(result.vmIdleCpuEquivalent, 0.8);
  assert.deepEqual(result.before, before);
  assert.deepEqual(result.after, after);
});

test('alternates all four frameworks across warmup and independent samples', () => {
  // Given: one warmup and three measured cycles.
  // When
  const plan = planMeasurements(config);
  // Then: a rotated order prevents the same app from always running first.
  assert.deepEqual(plan.map((item) => `${item.framework}:${item.warmup}`), [
    'fluo:true', 'next:true', 'react-router:true', 'tanstack-start:true',
    'next:false', 'react-router:false', 'tanstack-start:false', 'fluo:false',
    'react-router:false', 'tanstack-start:false', 'fluo:false', 'next:false',
    'tanstack-start:false', 'fluo:false', 'next:false', 'react-router:false',
  ]);
  assert.equal(new Set(plan.filter((item) => !item.warmup).map((item) => item.runId)).size, 12);
  assert.equal(PROFILES.desktop.cpuSlowdown, 1);
  assert.ok(PROFILES.tablet.cpuSlowdown > 1);
});

test('browser emulation matches the committed desktop and tablet baseline', async () => {
  // Given: baseline network rates are kilobits per second.
  const baseline = JSON.parse(await readFile(new URL('../baseline.json', import.meta.url), 'utf8'));
  // When / Then: CDP expects bytes per second, not kilobits per second.
  for (const [device, mode] of [['desktop', 'native'], ['tablet', 'matched-cache']]) {
    const expected = baseline.profiles[`${device}-${mode}`];
    assert.equal(PROFILES[device].cpuSlowdown, expected.cpuSlowdown);
    assert.equal(PROFILES[device].latencyMs, expected.network.latencyMs);
    assert.equal(PROFILES[device].downloadBytesPerSecond, expected.network.downloadKbps * 125);
    assert.equal(PROFILES[device].uploadBytesPerSecond, expected.network.uploadKbps * 125);
    assert.ok(expected.viewport.width > 0 && expected.viewport.height > 0);
    assert.deepEqual(PROFILES[device].viewport, expected.viewport);
  }
});

test('the raw measurement metric vocabulary matches the evaluator', async () => {
  // Given: the evaluator owns the machine-consumed metric contract.
  const { METRICS } = await import('../src/measure.mjs');
  // When / Then: drift cannot leave an evaluator metric unreported silently.
  assert.deepEqual(METRICS, EVALUATOR_METRICS);
});

test('production correctness remains mandatory when development measurements are configured', async () => {
  // Given: development commands exist but the production journeys do not.
  // When / Then: a production run cannot be replaced by a development ready event.
  await assert.rejects(createBrowserDriver({ ...config, dev: {} }, { devMode: false }), /journeys/);
});

test('checks correctness before timing and retains failed-run evidence', async () => {
  // Given: the first framework fails its correctness journey.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  const calls = [];
  try {
    // When
    const result = await collectMeasurements(config, {
      async check(item) { calls.push(`check:${item.framework}`); return { pass: item.framework !== 'fluo', steps: ['listing', 'auth'] }; },
      async measure(item) { calls.push(`measure:${item.framework}`); return { metrics: { coldTtfbMs: 25 }, requests: [] }; },
    }, directory);
    // Then: failure is recorded but never timed, including during warmup.
    assert.ok(!calls.includes('measure:fluo'));
    assert.equal(result.runs.length, 12);
    assert.equal(result.runs[0].warmupRuns, 1);
    assert.ok(result.runs.filter((run) => run.framework === 'fluo').every((run) => run.correctness === 'fail' && Object.keys(run.metrics).length === 0));
    const trace = JSON.parse(await readFile(result.runs.find((run) => run.framework === 'fluo').trace, 'utf8'));
    assert.equal(trace.correctness.pass, false);
    assert.equal(trace.provenance.lockfile, 'sha256:abc');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing observations stay unavailable and cannot become zero-valued metrics', async () => {
  // Given: a driver only reports a measured TTFB.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    // When
    const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: ['listing'] }; },
      async measure() { return { metrics: { coldTtfbMs: 42 }, unavailable: { lcpMs: 'browser did not emit LCP' }, requests: [] }; },
    }, directory);
    // Then: evaluator sees absent values; trace preserves why.
    assert.equal(result.runs[0].metrics.coldTtfbMs, 42);
    assert.equal(Object.hasOwn(result.runs[0].metrics, 'lcpMs'), false);
    const trace = JSON.parse(await readFile(result.runs[0].trace, 'utf8'));
    assert.equal(trace.unavailable.lcpMs, 'browser did not emit LCP');
    assert.equal(trace.unavailable.devColdReadyMs, 'not measured in production-browser mode');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a replaced interaction document makes correctness inconclusive in the retained trace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: ['jukebox'] }; },
      async measure() {
        return { metrics: { errorRate: 0 }, unavailable: {
          interactionApprovedP50Ms: 'document replaced the browser timing observer',
        }, requests: [], qualityFailures: ['document replaced the browser timing observer'] };
      },
    }, directory);
    assert.ok(result.runs.every((run) => run.correctness === 'inconclusive'));
    const trace = JSON.parse(await readFile(result.runs[0].trace, 'utf8'));
    assert.deepEqual(trace.qualityFailures, ['document replaced the browser timing observer']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid profiles and forged non-finite metrics before saving traces', async () => {
  // Given: unsupported profile and a non-finite timing.
  assert.throws(() => planMeasurements({ ...config, profile: 'phone' }), /profile/);
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    // When / Then
    await assert.rejects(collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: [] }; },
      async measure() { return { metrics: { lcpMs: Number.NaN } }; },
    }, directory), /lcpMs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('development readiness and edit visibility use separate raw runs', async () => {
  // Given: an observed ready event and separate React, CSS, and server edits.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  const events = [];
  try {
    // When
    const result = await collectDevMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { events.push('check'); return { pass: true, steps: ['dev-start'] }; },
      async restartDev() { events.push('restart'); return { pass: true, steps: ['fresh-dev-start'] }; },
      async measureDev(_item, _config, kind) { events.push(kind); return { durationMs: 25, event: `${kind}-visible` }; },
    }, directory);
    // Then: edit-to-visible timings are not conflated with production navigation.
    assert.deepEqual(events, Array.from({ length: 4 }, () => [
      'check', 'cold-ready', 'restart', 'react-edit',
      'restart', 'css-edit', 'restart', 'server-edit',
    ]).flat());
    assert.equal(result.runs[0].metrics.devReactEditVisibleMs, 25);
    assert.equal(Object.hasOwn(result.runs[0].metrics, 'coldTtfbMs'), false);
    assert.deepEqual(Object.keys((JSON.parse(await readFile(result.runs[0].trace, 'utf8'))).timings),
      ['cold-ready', 'react-edit-ready', 'react-edit', 'css-edit-ready', 'css-edit',
        'server-edit-ready', 'server-edit']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('development closes each completed app before the next cycle reuses its port', async () => {
  // Given: a run uses one owned dev server and the next cycle must use its port.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  const active = new Set();
  const released = [];
  try {
    // When: a warmup and a measured cycle visit every app twice.
    await collectDevMeasurements({ ...config, warmupRuns: 1, measurementRuns: 1 }, {
      async check(item) {
        assert.equal(active.has(item.framework), false, `port already owned by ${item.framework}`);
        active.add(item.framework);
        return { pass: true, steps: ['ready'] };
      },
      async measureDev(_item, _config, kind) { return { durationMs: 25, event: `${kind}-visible` }; },
      async closeDev(item) {
        assert.equal(active.delete(item.framework), true);
        released.push(item.framework);
      },
    }, directory);
    // Then: no server remains at the end of the repeated measurement.
    assert.equal(active.size, 0);
    assert.equal(released.length, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('combines matching production and development evidence without inventing values', async () => {
  // Given: a production sample and independently traced development sample.
  const production = { runs: [{ framework: 'fluo', runId: 'r-1', profile: 'desktop-native', mode: 'native',
    warmupRuns: 1, correctness: 'pass', trace: '/tmp/production.json', metrics: { lcpMs: 12 } }] };
  const development = { runs: [{ ...production.runs[0], trace: '/tmp/dev.json', metrics: { devColdReadyMs: 30 } }] };
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    // When
    const result = await mergeEvidence(production, development, directory);
    // Then
    assert.deepEqual(result.runs[0].metrics, { lcpMs: 12, devColdReadyMs: 30 });
    assert.equal(Object.hasOwn(result.runs[0].metrics, 'rssBytes'), false);
    assert.deepEqual(JSON.parse(await readFile(result.runs[0].trace, 'utf8')).sourceTraces,
      ['/tmp/production.json', '/tmp/dev.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('gate rejects missing, escaped, and incomplete raw traces', async () => {
  // Given: a good local trace and invalid trace references.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: [] }; },
      async measure() { return { metrics: { coldTtfbMs: 10 } }; },
    }, directory);
    // When / Then: real trace resolves but a missing or escaped path never does.
    await verifyTraceFiles(result.runs, directory);
    await assert.rejects(verifyTraceFiles([{ ...result.runs[0], trace: join(directory, 'missing.json') }], directory), /trace/);
    await assert.rejects(verifyTraceFiles([{ ...result.runs[0], trace: '/tmp/outside.json' }], directory), /trace/);
    const broken = join(directory, 'incomplete.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(broken, '{"schemaVersion":1}'));
    await assert.rejects(verifyTraceFiles([{ ...result.runs[0], trace: broken }], directory), /trace/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native trace authentication rejects missing, altered, incomplete and escaped evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-trace-auth-'));
  const outside = await mkdtemp(join(tmpdir(), 'native-trace-outside-'));
  const rawTrace = join(directory, 'native.json');
  const cdpTrace = join(directory, 'cdp.json');
  const nativeBytes = JSON.stringify({ constants: { logEventTypes: { CANCELLED: 0 } }, events: [{ type: 0 }] });
  const cdpBytes = JSON.stringify({ ledger: [] });
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const observer = { rawTrace, cdpTrace, sha256: hash(nativeBytes), cdpSha256: hash(cdpBytes) };
  await writeFile(rawTrace, nativeBytes);
  await writeFile(cdpTrace, cdpBytes);
  const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
    async check() { return { pass: true, steps: [] }; },
    async measure(item) {
      assert.equal(item.nativeTraceDirectory, directory);
      return { metrics: {}, requests: [], artifacts: { nativeTerminalObserver: observer } };
    },
  }, directory);
  await verifyTraceFiles(result.runs, directory);
  await writeFile(rawTrace, '{}');
  await assert.rejects(verifyTraceFiles(result.runs, directory), /digest mismatch/u);
  const trace = JSON.parse(await readFile(result.runs[0].trace, 'utf8'));
  trace.artifacts.nativeTerminalObserver.sha256 = hash('{}');
  await writeFile(result.runs[0].trace, JSON.stringify(trace));
  await assert.rejects(verifyTraceFiles([result.runs[0]], directory), /incomplete native trace/u);
  trace.artifacts.nativeTerminalObserver.rawTrace = join(outside, 'native.json');
  await writeFile(trace.artifacts.nativeTerminalObserver.rawTrace, nativeBytes);
  await writeFile(result.runs[0].trace, JSON.stringify(trace));
  await assert.rejects(verifyTraceFiles([result.runs[0]], directory), /outside output root/u);
  trace.artifacts.nativeTerminalObserver.rawTrace = join(directory, 'missing.json');
  await writeFile(result.runs[0].trace, JSON.stringify(trace));
  await assert.rejects(verifyTraceFiles([result.runs[0]], directory), { code: 'ENOENT' });
});

async function lifetimeTraceFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'native-lifetime-trace-'));
  const measurement = { runId: 'fixture-run', framework: 'next', profile: 'desktop-native', mode: 'native' };
  const observer = await createNativeLifetimeObserver({ enabled: true, directory, measurement });
  // Unsupported browser is intentional: complete failure artifacts must still
  // authenticate, and their missing coverage must remain inconclusive.
  await observer.prepare({ version: () => 'unsupported' }, 123, {});
  const evidence = await observer.drain(10, []);
  const reasons = reconcileNativeLifetime([], evidence.observation, []).unavailable;
  const trace = join(directory, 'trace.json');
  const record = { schemaVersion: 1, ...measurement, provenance: {}, environment: {}, profileSettings: {},
    correctness: { pass: true }, metrics: {}, unavailable: {}, qualityFailures: reasons,
    requests: [], artifacts: { nativeLifetimeObserver: evidence.provenance } };
  await writeFile(trace, JSON.stringify(record));
  return { directory, trace, record, evidence };
}

test('native lifetime unavailable evidence authenticates in raw, combined and warmup paths', async () => {
  const fixture = await lifetimeTraceFixture();
  try {
    await verifyTraceFiles([{ trace: fixture.trace, warmup: true }], fixture.directory);
    const combined = join(fixture.directory, 'combined.json');
    await writeFile(combined, JSON.stringify({ schemaVersion: 1, sourceTraces: [fixture.trace, fixture.trace],
      correctness: { production: 'inconclusive', development: 'inconclusive' } }));
    await verifyTraceFiles([{ trace: combined }], fixture.directory);
    fixture.record.qualityFailures = [];
    await writeFile(fixture.trace, JSON.stringify(fixture.record));
    await assert.rejects(verifyTraceFiles([{ trace: combined }], fixture.directory), /inconclusive reasons missing/u);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

for (const [name, mutate, expected] of [
  ['missing', async (f, ref) => { ref.path = join(f.directory, 'absent.json'); }, /ENOENT/u],
  ['truncated', async (_f, ref) => { await writeFile(ref.path, '{'); }, /digest mismatch/u],
  ['malformed schema', async (_f, ref) => {
    await writeFile(ref.path, '{}'); ref.sha256 = createHash('sha256').update('{}').digest('hex');
  }, /cross-run\/schema mismatch/u],
  ['cross-run', async (_f, ref) => {
    const raw = JSON.parse(await readFile(ref.path, 'utf8')); raw.runId = 'other';
    const bytes = JSON.stringify(raw); await writeFile(ref.path, bytes);
    ref.sha256 = createHash('sha256').update(bytes).digest('hex');
  }, /cross-run\/schema mismatch/u],
  ['coverage tamper', async (f) => {
    const ref = f.record.artifacts.nativeLifetimeObserver.references.find((entry) => entry.role === 'coverage');
    const raw = JSON.parse(await readFile(ref.path, 'utf8')); raw.coverage.ready = true;
    const bytes = JSON.stringify(raw); await writeFile(ref.path, bytes);
    ref.sha256 = createHash('sha256').update(bytes).digest('hex');
  }, /authentication mismatch/u],
  ['native event tamper', async (_f, ref) => {
    const raw = JSON.parse(await readFile(ref.path, 'utf8')); raw.events = [{ event: 'cancel-return' }];
    const bytes = JSON.stringify(raw); await writeFile(ref.path, bytes);
    ref.sha256 = createHash('sha256').update(bytes).digest('hex');
  }, /replay mismatch/u],
  ['observer schema source tamper', async (f) => {
    const ref = f.record.artifacts.nativeLifetimeObserver.references.find((entry) => entry.role === 'schema');
    const raw = JSON.parse(await readFile(ref.path, 'utf8')); raw.agentSha256 = '0'.repeat(64);
    const bytes = JSON.stringify(raw); await writeFile(ref.path, bytes);
    ref.sha256 = createHash('sha256').update(bytes).digest('hex');
  }, /authentication mismatch/u],
  ['measurement identity reuse', async (f) => { f.record.runId = 'other-invocation'; }, /measurement identity mismatch/u],
  ['reconciliation result tamper', async (f) => {
    f.record.requests = [{ kind: 'request-failed', canceled: true, nativeLifetime: { runId: 'forged' },
      cdpObservation: { kind: 'request-pending', requestId: '1.1' } }];
  }, /reconciliation replay mismatch/u],
  ['symlink escape', async (f, ref) => {
    const { symlink } = await import('node:fs/promises');
    const outside = await mkdtemp(join(tmpdir(), 'native-lifetime-outside-'));
    f.outside = outside;
    const path = join(outside, 'native.json'); await writeFile(path, await readFile(ref.path));
    const link = join(f.directory, 'escape.json'); await symlink(path, link); ref.path = link;
  }, /outside output root/u],
]) {
  test(`native lifetime trace authentication rejects ${name}`, async () => {
    const fixture = await lifetimeTraceFixture();
    try {
      await verifyTraceFiles([{ trace: fixture.trace }], fixture.directory);
      await mutate(fixture, fixture.record.artifacts.nativeLifetimeObserver.references[0]);
      await writeFile(fixture.trace, JSON.stringify(fixture.record));
      await assert.rejects(verifyTraceFiles([{ trace: fixture.trace }], fixture.directory), expected);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
      if (fixture.outside) await rm(fixture.outside, { recursive: true, force: true });
    }
  });
}

test('native lifetime and passive NetLog observers must retain the same original CDP ledger and cutoff', async () => {
  const fixture = await lifetimeTraceFixture();
  try {
    const netlog = join(fixture.directory, 'netlog.json');
    const cdp = join(fixture.directory, 'passive-cdp.json');
    const logBytes = JSON.stringify({ constants: { logEventTypes: { CANCELLED: 0 } }, events: [{ type: 0 }] });
    const cdpBytes = JSON.stringify({ ledger: [{ name: 'unrelated-invocation', data: {} }] });
    await writeFile(netlog, logBytes); await writeFile(cdp, cdpBytes);
    fixture.record.artifacts.nativeTerminalObserver = { rawTrace: netlog, cdpTrace: cdp,
      sha256: createHash('sha256').update(logBytes).digest('hex'),
      cdpSha256: createHash('sha256').update(cdpBytes).digest('hex'), captureTimestamp: 10 };
    await writeFile(fixture.trace, JSON.stringify(fixture.record));
    await assert.rejects(verifyTraceFiles([{ trace: fixture.trace }], fixture.directory), /CDP ledger mismatch/u);
    await writeFile(cdp, JSON.stringify({ ledger: [] }));
    fixture.record.artifacts.nativeTerminalObserver.cdpSha256 = createHash('sha256')
      .update(JSON.stringify({ ledger: [] })).digest('hex');
    fixture.record.artifacts.nativeTerminalObserver.captureTimestamp = 11;
    await writeFile(fixture.trace, JSON.stringify(fixture.record));
    await assert.rejects(verifyTraceFiles([{ trace: fixture.trace }], fixture.directory), /capture boundary mismatch/u);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
