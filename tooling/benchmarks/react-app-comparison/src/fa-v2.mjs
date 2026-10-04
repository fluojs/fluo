import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { replayServerCpu } from './server-cpu.mjs';

export const METHOD_VERSION = 'FA-V2';
export const hashObject = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashBytes = (value) => createHash('sha256').update(value).digest('hex');
const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];

export function assertMethodConfig(config) {
  if (config.methodVersion !== METHOD_VERSION || !['timing', 'native-conformance'].includes(config.measurementPurpose)
    || typeof config.pairId !== 'string' || !config.pairId.trim()
    || !['before', 'after'].includes(config.pairPhase)
    || (config.measurementKind !== undefined && !['production', 'development'].includes(config.measurementKind))
    || config.warmupRuns !== 2 || config.measurementRuns !== 5
    || config.nativeLifetime?.enabled !== (config.measurementPurpose === 'native-conformance')) {
    throw new Error('FA-V2 requires explicit purpose/pair, five measured/two warmups and purpose-specific observer');
  }
  if (config.measurementPurpose === 'native-conformance' && !isAbsolute(config.nativeLifetime.python ?? '')) {
    throw new Error('FA-V2 native-conformance requires absolute Python');
  }
  for (const framework of frameworks) {
    const workload = config.throughput?.[framework];
    if (workload?.requests !== 200 || workload.concurrency !== 8) {
      throw new Error('FA-V2 frozen workload requires 200 requests/concurrency 8');
    }
  }
}

function stimuli(config) {
  const { measurementPurpose, nativeLifetime, provenance, serverPids,
    environmentBinding, isolatedRepresentative, ...settings } = config;
  return settings;
}

export function pairStimuliIdentity(config) {
  const { pairPhase, ...settings } = stimuli(config);
  const roots = [config.provenance?.root, ...Object.values(config.dev ?? {}).map((definition) => definition.cwd)]
    .filter((path) => isAbsolute(path ?? '')).sort((a, b) => b.length - a.length);
  const normalize = (value) => {
    if (typeof value === 'string') {
      const root = roots.find((path) => value === path || value.startsWith(`${path}/`));
      return root ? `$root${value.slice(root.length)}` : value;
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, entry]) => [key, normalize(entry)]));
    return value;
  };
  return hashObject(normalize(settings));
}

// This classification is not authentication. Only the existing source-bound
// environment verifier may authorize the explicitly identified RE-A01 relation.
export function pairStimuliComparison(before, after) {
  if (pairStimuliIdentity(before) === pairStimuliIdentity(after)) return 'identical';
  if (before.measurementKind !== 'development' || after.measurementKind !== 'development'
    || before.pairPhase !== 'before' || after.pairPhase !== 'after'
    || before.measurementPurpose !== after.measurementPurpose) return 'mismatch';
  const stimulus = { from: 'Editor login', to: 'Editor login changed', path: '/login',
    selector: 'h1', expectedText: 'Editor login changed' };
  if (!isDeepStrictEqual(before.dev?.fluo?.edits?.['react-edit'],
    { ...stimulus, file: 'src/document.ts', reload: true })
    || !isDeepStrictEqual(after.dev?.fluo?.edits?.['react-edit'],
      { ...stimulus, file: 'src/catalog-destination.tsx', reload: false })) return 'mismatch';
  const expected = structuredClone(before);
  Object.assign(expected.dev.fluo.edits['react-edit'], { file: 'src/catalog-destination.tsx', reload: false });
  return pairStimuliIdentity(expected) === pairStimuliIdentity(after)
    ? 'react-edit-source-relation-required' : 'mismatch';
}

export async function captureMethodBinding(config, directory) {
  assertMethodConfig(config);
  const executionId = randomUUID();
  const { environmentBinding, isolatedRepresentative, ...settings } = config;
  const configuration = { ...settings, measurementKind: config.measurementKind ?? 'production' };
  const binding = {
    methodVersion: METHOD_VERSION, measurementPurpose: config.measurementPurpose,
    pairId: config.pairId, pairPhase: config.pairPhase,
    executionId, configSha256: hashObject(configuration), stimuliSha256: hashObject(stimuli(configuration)),
    productSha256: hashObject(config.provenance), baselineSha256: config.provenance?.baselineSha256,
  };
  if (!/^[a-f0-9]{64}$/u.test(binding.baselineSha256 ?? '')) throw new Error('FA-V2 baseline identity required');
  const path = resolve(directory, `method-${executionId}.json`);
  const raw = JSON.stringify({ ...binding, configuration });
  await writeFile(path, raw, { flag: 'wx' });
  return { ...binding, path, sha256: hashBytes(raw) };
}

export async function verifyMethodBinding(binding, root) {
  if (binding?.methodVersion !== METHOD_VERSION || !isAbsolute(binding.path ?? '')) {
    throw new Error('FA-V2 authenticated method binding required');
  }
  const base = await realpath(root);
  const path = await realpath(binding.path);
  const location = relative(base, path);
  if (location.startsWith('..') || isAbsolute(location)) throw new Error('FA-V2 method outside output root');
  const raw = await readFile(path);
  if (hashBytes(raw) !== binding.sha256) throw new Error('FA-V2 configuration digest mismatch');
  const record = JSON.parse(raw);
  assertMethodConfig(record.configuration);
  for (const key of ['methodVersion', 'measurementPurpose', 'pairId', 'pairPhase', 'executionId', 'configSha256',
    'stimuliSha256', 'productSha256', 'baselineSha256']) {
    if (binding[key] !== record[key]) throw new Error(`FA-V2 method ${key} mismatch`);
  }
  if (record.configSha256 !== hashObject(record.configuration)
    || record.measurementPurpose !== record.configuration.measurementPurpose
    || record.pairId !== record.configuration.pairId
    || record.stimuliSha256 !== hashObject(stimuli(record.configuration))
    || record.productSha256 !== hashObject(record.configuration.provenance)
    || record.pairPhase !== record.configuration.pairPhase
    || record.baselineSha256 !== record.configuration.provenance?.baselineSha256) {
    throw new Error('FA-V2 configuration/product identity mismatch');
  }
  return record;
}

export async function verifyMethodTrace(record, expected, root) {
  if (!isDeepStrictEqual(record.methodBinding, expected?.methodBinding)
    || record.methodVersion !== METHOD_VERSION || record.methodVersion !== expected.methodVersion
    || record.measurementPurpose !== expected.measurementPurpose) throw new Error('FA-V2 sample/trace purpose mismatch');
  const method = await verifyMethodBinding(record.methodBinding, root);
  const config = method.configuration;
  if (record.profile !== config.profile || record.mode !== config.mode
    || record.measurementPurpose !== method.measurementPurpose
    || !isDeepStrictEqual(record.provenance, config.provenance)) throw new Error('FA-V2 raw configuration mismatch');
  for (const key of ['framework', 'runId', 'profile', 'mode']) {
    if (expected[key] !== undefined && record[key] !== expected[key]) throw new Error('FA-V2 raw sample identity mismatch');
  }
  if (record.sourceTraces) {
    if (record.serverCpuSha256 !== expected.serverCpuSha256) throw new Error('FA-V2 combined CPU identity mismatch');
    const values = [record.correctness.production, record.correctness.development];
    const correctness = values.includes('fail') ? 'fail' : values.includes('inconclusive') ? 'inconclusive' : 'pass';
    if (correctness !== expected.correctness) throw new Error('FA-V2 combined quality/summary mismatch');
    return;
  }
  const correctness = !record.correctness?.pass ? 'fail' : record.qualityFailures?.length ? 'inconclusive' : 'pass';
  if (expected.correctness !== undefined && expected.correctness !== correctness) {
    throw new Error('FA-V2 raw quality/summary mismatch');
  }
  if (!record.correctness?.pass) return;
  const development = config.measurementKind === 'development';
  if (development !== Boolean(record.timings?.['cold-ready'])) throw new Error('FA-V2 raw measurement kind mismatch');
  const lifetime = record.artifacts?.nativeLifetimeObserver;
  if (record.measurementPurpose === 'timing' && (lifetime || record.requests.some((request) => request.nativeLifetime))) {
    throw new Error('FA-V2 timing cannot borrow native-conformance terminals');
  }
  if (!development) {
    if (record.requests.some((request) => request.kind === 'request-pending') && !record.qualityFailures?.length) {
      throw new Error('FA-V2 pending request quality failure missing');
    }
    const settled = record.requests.filter((request) => request.kind !== 'request-pending');
    const errorRate = settled.length ? settled.filter((request) => request.error || request.status >= 400).length / settled.length : null;
    if (errorRate === null || record.metrics.errorRate !== errorRate) throw new Error('FA-V2 raw error rate mismatch');
    if (!record.artifacts?.nativeTerminalObserver) throw new Error('FA-V2 passive NetLog required');
    const passive = record.artifacts.nativeTerminalObserver;
    const cdpPath = await realpath(passive.cdpTrace);
    const location = relative(await realpath(root), cdpPath);
    if (location.startsWith('..') || isAbsolute(location)) throw new Error('FA-V2 passive trace outside output root');
    const bytes = await readFile(cdpPath);
    if (hashBytes(bytes) !== passive.cdpSha256) throw new Error('FA-V2 passive trace digest mismatch');
    const cdp = JSON.parse(bytes);
    const boundaries = cdp.ledger?.filter((entry) => entry.name === 'capture-boundary');
    if (boundaries?.length !== 1 || !isDeepStrictEqual(boundaries[0].data.methodBinding, record.methodBinding)
      || boundaries[0].data.captureTimestamp !== passive.captureTimestamp
      || cdp.cleanup?.closed !== true || cdp.cleanup.exitCode !== 0 || cdp.cleanup.signalCode !== null) {
      throw new Error('FA-V2 borrowed passive terminals/cutoff/exit');
    }
    if (record.measurementPurpose === 'native-conformance') {
      if (!lifetime || !isDeepStrictEqual(lifetime.measurement, {
        runId: record.runId, framework: record.framework, profile: record.profile, mode: record.mode,
        methodVersion: METHOD_VERSION, measurementPurpose: record.measurementPurpose,
        pairId: method.pairId, executionId: method.executionId,
      })) throw new Error('FA-V2 native counterpart ownership identity required');
    }
    const cpu = record.artifacts?.serverCpu;
    if (!cpu || record.artifacts.serverCpuSha256 !== hashObject(cpu)
      || record.artifacts.serverCpuSha256 !== expected.serverCpuSha256
      || cpu.pid !== config.serverPids?.[record.framework]
      || !isDeepStrictEqual(cpu, replayServerCpu(cpu))
      || cpu.cpuPercent !== record.metrics.cpuPercent || cpu.rssBytes !== record.metrics.rssBytes) {
      throw new Error('FA-V2 server CPU raw/config/metric identity mismatch');
    }
    if (!isDeepStrictEqual(record.artifacts.throughput, config.throughput[record.framework])
      || record.requests.filter((request) => request.resourceType === 'throughput').length !== 200) {
      throw new Error('FA-V2 raw workload identity mismatch');
    }
  }
}

export async function verifyMethodReceipt(receipt, root) {
  const method = await verifyMethodBinding(receipt.methodBinding, root);
  if (receipt.methodVersion !== METHOD_VERSION || receipt.measurementPurpose !== method.measurementPurpose
    || receipt.profile !== method.configuration.profile || receipt.mode !== method.configuration.mode
    || !isDeepStrictEqual(receipt.provenance, method.configuration.provenance)) {
    throw new Error('FA-V2 receipt identity mismatch');
  }
  for (const run of [...receipt.runs, ...receipt.warmups]) {
    if (!isDeepStrictEqual(run.methodBinding, receipt.methodBinding)
      || run.methodVersion !== receipt.methodVersion || run.measurementPurpose !== receipt.measurementPurpose
      || run.profile !== receipt.profile || run.mode !== receipt.mode || !frameworks.includes(run.framework)) {
      throw new Error('FA-V2 receipt sample identity mismatch');
    }
  }
  if (receipt.developmentWarmups || receipt.developmentMethodBinding) {
    const development = await verifyMethodBinding(receipt.developmentMethodBinding, root);
    if (development.productSha256 !== method.productSha256 || development.pairId !== method.pairId
      || development.measurementPurpose !== method.measurementPurpose
      || development.executionId === method.executionId) throw new Error('FA-V2 development binding mismatch');
    for (const run of receipt.developmentWarmups ?? []) {
      if (!isDeepStrictEqual(run.methodBinding, receipt.developmentMethodBinding)
        || run.methodVersion !== receipt.methodVersion || run.measurementPurpose !== receipt.measurementPurpose
        || run.profile !== receipt.profile || run.mode !== receipt.mode || !frameworks.includes(run.framework)) {
        throw new Error('FA-V2 development warmup binding mismatch');
      }
    }
  }
  return method;
}
