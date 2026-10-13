import { hostname } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import design from './design-windows-server.json' with { type: 'json' };
import { object, sha256 } from '../../src/profile-report.js';
import { SCENARIOS, STAGE_SCENARIOS, type ScenarioConfig } from '../../src/scenarios.js';

export { design };
export const designSha256 = sha256(JSON.stringify(design));
export class ExperimentInputFailure extends Error {}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ExperimentInputFailure('Missing identity string');
  return value;
}
export function hash(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new ExperimentInputFailure('Invalid SHA256 identity');
  return result;
}
export function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new ExperimentInputFailure('Invalid positive number');
  return value;
}
export function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new ExperimentInputFailure(`Identity mismatch: ${label}`);
}
export function identities(input: unknown) {
  const value = object(input);
  const server = object(value.server);
  const generator = object(value.generator);
  const port = positive(server.port);
  if (!Number.isSafeInteger(port) || port > 65535) throw new ExperimentInputFailure('Invalid server port');
  const parsed = {
    server: {
      hostname: text(server.hostname), runtime: text(server.runtime),
      executable: text(server.executable), executableSha256: hash(server.executableSha256),
      address: text(server.address), bindHost: text(server.bindHost), port,
      hostConfigurationSha256: hash(server.hostConfigurationSha256),
      cpuCounterMethod: text(server.cpuCounterMethod), cpuCounterResolutionSeconds: positive(server.cpuCounterResolutionSeconds),
    },
    generator: {
      hostname: text(generator.hostname), runtime: text(generator.runtime),
      executable: text(generator.executable), executableSha256: hash(generator.executableSha256),
      lockfileSha256: hash(generator.lockfileSha256), clientSha256: hash(generator.clientSha256),
      sshHost: text(generator.sshHost), remoteDirectory: text(generator.remoteDirectory),
      hostConfigurationSha256: hash(generator.hostConfigurationSha256),
    },
    network: { topologySha256: hash(object(value.network).topologySha256) },
    buildReceipt: { path: text(object(value.buildReceipt).path), sha256: hash(object(value.buildReceipt).sha256) },
    priorPolicy: { path: text(object(value.priorPolicy).path), sha256: hash(object(value.priorPolicy).sha256) },
    headroomWorkload: text(value.headroomWorkload),
  };
  if (parsed.server.hostname === parsed.generator.hostname) throw new ExperimentInputFailure('Separate server and generator hosts required');
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(parsed.generator.remoteDirectory)) throw new ExperimentInputFailure('Unsafe generator directory');
  if (!design.workloads.includes(parsed.headroomWorkload)) throw new ExperimentInputFailure('Unknown frozen headroom workload');
  return parsed;
}
export type Identities = ReturnType<typeof identities>;

export function scenarios(): readonly ScenarioConfig[] {
  const staticHit = STAGE_SCENARIOS.find((item) => item.appShape === 'stage-minimal');
  const parameterHit = STAGE_SCENARIOS.find((item) => item.appShape === 'stage-routing-params');
  if (!staticHit || !parameterHit) throw new ExperimentInputFailure('Missing canonical stage fixture');
  return [
    { ...staticHit, name: 'static-hit' },
    { ...parameterHit, name: 'parameter-hit' },
    { ...parameterHit, name: 'normalization-fallback', requests: parameterHit.requests.map((request) => ({
      ...request, path: '/stage//items/item-7/?value=alpha',
    })) },
    ...SCENARIOS,
  ];
}
export function schedule() {
  return scenarios().flatMap((scenario) => design.configurations.flatMap((configuration) =>
    design.connections.flatMap((connections) => design.pairOrder.flatMap((arms, pair) =>
      arms.map((arm) => ({ workload: scenario.name, configuration, connections, pair, arm }))))));
}
export type Condition = ReturnType<typeof schedule>[number];

export function frozenManifest(input: unknown) {
  const value = object(input);
  equal(value.design, design, 'frozen design');
  equal(value.designSha256, designSha256, 'design digest');
  const identity = identities(value.identities);
  const prepared = object(value.prepared);
  const artifacts = object(prepared.artifacts);
  for (const [path, digest] of Object.entries(artifacts)) { text(path); hash(digest); }
  if (Object.keys(artifacts).length === 0) throw new ExperimentInputFailure('Missing build artifacts');
  equal(prepared.artifactsSha256, sha256(JSON.stringify(artifacts)), 'artifact digest');
  const source = object(prepared.source);
  if (!/^[a-f0-9]{40}$/.test(text(source.gitHead))) throw new ExperimentInputFailure('Invalid source head');
  if (typeof source.gitStatus !== 'string') throw new ExperimentInputFailure('Missing source status');
  const locks = object(source.lockfiles);
  if (Object.keys(locks).length !== 2) throw new ExperimentInputFailure('Both lockfiles required');
  Object.values(locks).forEach(hash);
  hash(source.benchmarkSourceSha256);
  return { design, designSha256, identities: identity, prepared };
}
export type Manifest = ReturnType<typeof frozenManifest>;
export function assertLocalServer(identity: Identities): void {
  equal(hostname(), identity.server.hostname, 'actual local server host');
}
export function assertPriorLimits(input: unknown): void {
  const limits = object(object(input).applicableLimits);
  for (const key of ['minimumCompletedRequests', 'minimumCpuResolutionMultiple'] as const) {
    if (design[key] < positive(limits[key])) throw new ExperimentInputFailure(`Stricter prior policy conflicts with frozen ${key}`);
  }
  if (design.throughputCvMaximum > positive(limits.throughputCvMaximum)) throw new ExperimentInputFailure('Stricter prior stability policy');
  for (const group of ['aaMeanDifferenceMaximum', 'regressionMaximum'] as const) {
    const maximum = object(limits[group]);
    for (const key of ['throughput', 'cpuPerRequest', 'p95', 'p99', 'rss'] as const) {
      if (design[group][key] > positive(maximum[key])) throw new ExperimentInputFailure(`Stricter prior ${group}.${key}`);
    }
  }
  const gain = object(limits.minimumHitImprovement);
  for (const key of ['throughput', 'cpuPerRequest'] as const) {
    if (design.minimumHitImprovement[key] < positive(gain[key])) throw new ExperimentInputFailure(`Stricter prior gain ${key}`);
  }
  if (design.headroom.maximumThroughputIncrease > positive(object(limits.headroom).maximumThroughputIncrease)) {
    throw new ExperimentInputFailure('Stricter prior headroom policy');
  }
  equal(limits.automaticAdditionalRepeats, 0, 'prior finite retries');
  equal(limits.outlierDeletionAllowed, false, 'prior outlier policy');
}
