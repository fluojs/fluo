import type { NodeSubject } from '../../results/issue-3914/paired-aa.mjs';
import { BLOCKS, CV, LIMITS, pairedCondition, sha256 } from '../../results/issue-3914/paired-aa.mjs';
import { planFixture as abPlanFixture } from './paired-ab-evidence.mjs';

export function planFixture(platform: NodeSubject['platform'] = 'nodejs', mode: NodeSubject['mode'] = 'candidate') {
  const baseline = abPlanFixture();
  return {
    ...baseline, schema: 'paired-node-v1', mode, condition: pairedCondition({ platform, mode }),
    freeze: { ...baseline.freeze, orchestratorSha256: sha256('orchestrator'),
      runtimeExecutable: '/prepared/node', containerIdentity: 'fixture-linux-node',
      generator: { protocol: 'local-session-v1', node: 'v24.21.0', executable: '/prepared/node', hostname: 'fixture-host' } },
    arms: mode === 'calibration'
      ? { ...baseline.arms, Y: structuredClone(baseline.arms.X) } : baseline.arms,
  };
}

export function protocolFixture(plan = planFixture()) {
  return {
    schema: 'paired-node-v1', mode: plan.mode, status: 'FROZEN', condition: plan.condition,
    blocks: BLOCKS, maxCv: CV, ratioLimits: LIMITS, automaticAdditionalRepeats: 0,
    outlierDeletionAllowed: false, freshServerPerRun: true, maximumCpuQuantizationFraction: 0.01,
    generatorLifetime: 'one-local-session-per-server-run',
    baselineFrameworkSource: plan.arms.X.frameworkSource, candidateFrameworkSource: plan.arms.Y.frameworkSource,
    baselinePackagesTree: plan.arms.X.packagesTree, candidatePackagesTree: plan.arms.Y.packagesTree,
    calibration: {
      schema: 'paired-node-v1', mode: 'calibration', condition: { ...plan.condition },
      frameworkSource: plan.arms.X.frameworkSource, packagesTree: plan.arms.X.packagesTree,
      planSha256: plan.calibrationPlanSha256, verdict: 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE',
    },
  };
}

function traffic(total = 20_000, duration = 60, connections = 64) {
  return {
    result: { errors: 0, timeouts: 0, non2xx: 0, mismatches: 0, connections, duration,
      requests: { total, average: 1_000 } },
    statusMismatches: 0, latencyHistogramMicros: [[1_000, total]],
  };
}

export function evidenceFixture(plan = planFixture()) {
  return {
    planSha256: sha256(JSON.stringify(plan)), invalidAttempts: [] as unknown[],
    records: BLOCKS.flatMap((arms, block) => arms.map((arm, slot) => {
      const ordinal = block * 4 + slot;
      const descriptor = plan.arms[arm];
      const pid = ordinal + 100;
      const generator = { ...plan.freeze.generator, pid: ordinal + 10_000, nonce: `generator-${ordinal}` };
      const label = `${arm === 'N' ? 'native' : 'fluo'}-${plan.condition.platform}`;
      return {
        ordinal, block, slot, arm, condition: { ...plan.condition }, cwd: descriptor.cwd,
        startedMs: ordinal * 100_000 + 1, endedMs: ordinal * 100_000 + 90_001,
        child: { pid: ordinal + 20_000, exitCode: 0, signal: null as string | null, timedOut: false, error: null as string | null },
        identity: {
          head: descriptor.head, frameworkSource: descriptor.frameworkSource,
          collectorSha256: plan.freeze.collectorSha256, harnessSha256: plan.freeze.harnessSha256,
          buildReceiptSha256: descriptor.buildReceipt.sha256, containerIdentity: plan.freeze.containerIdentity,
        },
        raw: {
          ...traffic(), label, generator,
          warmup: { ...traffic(10_000, 30), generator: { ...generator } },
          coldStart: { processToReadyMs: 1, firstRequest: { ...traffic(1, 1, 1), generator: { ...generator } } },
          servingIdentity: {
            status: 'authenticated', instrumentation: 'none', target: label,
            pid, launcherPid: pid, nonce: `server-${ordinal}`, runtime: { node: '24.21.0' },
            executableSha256: plan.freeze.runtimeExecutableSha256,
            artifactsSha256: descriptor.targetArtifactsSha256, artifacts: { ...descriptor.artifacts },
            source: { gitHead: descriptor.head, gitStatus: '', benchmarkSourceSha256: plan.freeze.harnessSha256 },
          },
          server: {
            subject: 'server-process-tree', rootPid: pid, method: plan.freeze.cpuPrecision.method, wallSeconds: 60,
            cpuSeconds: 2, cpuTimeResolutionSeconds: plan.freeze.cpuPrecision.resolutionSeconds, peakRssBytes: 102_400,
            samples: [
              { wallMs: 1, processes: [{ pid, rssKiB: 100, cpuSeconds: 0 }] },
              { wallMs: 60_001, processes: [{ pid, rssKiB: 100, cpuSeconds: 2 }] },
            ],
          },
        },
      };
    })),
  };
}
export type EvidenceFixture = ReturnType<typeof evidenceFixture>;
