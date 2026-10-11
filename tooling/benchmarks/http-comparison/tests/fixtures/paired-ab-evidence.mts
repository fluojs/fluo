import { BLOCKS, CONDITION, CV, LIMITS, sha256 } from '../../results/issue-3914/paired-aa.mjs';

const digest = sha256('fixture');
const cpuPrecision = { method: 'verified-fixture-cpu-counter', resolutionSeconds: 0.001, verified: true };

export function planFixture() {
  const arm = (name: string, candidate = false) => {
    const workspace = `/prepared/${name}`;
    const cwd = `${workspace}/tooling/benchmarks/http-comparison`;
    const artifacts = {
      [`${cwd}/server.js`]: digest,
      [`${workspace}/pnpm-lock.yaml`]: digest,
      [`${cwd}/pnpm-lock.yaml`]: digest,
    };
    return {
      cwd, head: (candidate ? '3' : '1').repeat(40), frameworkSource: (candidate ? '4' : '2').repeat(40),
      packagesTree: (candidate ? '6' : '5').repeat(40), artifacts,
      targetArtifactsSha256: sha256(JSON.stringify(artifacts)),
      buildReceipt: { path: `${workspace}/receipt.json`, sha256: digest },
    };
  };
  return {
    schema: 'paired-ab-v1', status: 'FROZEN', condition: CONDITION, blocks: BLOCKS,
    orderSeed: 'fixed-fixture', previousPolicySha256: digest, calibrationPlanSha256: digest,
    protocol: { path: '/prepared/protocol.json', sha256: digest },
    maxCv: CV, ratioLimits: LIMITS, automaticAdditionalRepeats: 0, outlierDeletionAllowed: false,
    freshServerPerRun: true, maximumCpuQuantizationFraction: 0.01,
    generatorLifetime: 'one-local-session-per-server-run',
    freeze: {
      planPath: '/prepared/plan.json', outputRoot: '/prepared/output',
      collectorSha256: digest, validatorSha256: digest, harnessSha256: digest,
      runtimeExecutable: '/prepared/bun', runtimeExecutableSha256: digest,
      generatorExecutableSha256: digest, containerIdentity: 'fixture-linux-bun', cpuPrecision,
      generator: { protocol: 'local-session-v1', node: process.version, executable: process.execPath, hostname: 'fixture-host' },
    },
    arms: { N: arm('baseline'), X: arm('baseline'), Y: arm('candidate', true) },
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
      return {
        ordinal, block, slot, arm, condition: CONDITION, cwd: descriptor.cwd,
        startedMs: ordinal * 100_000 + 1, endedMs: ordinal * 100_000 + 90_001,
        child: { pid: ordinal + 20_000, exitCode: 0, signal: null as string | null, timedOut: false, error: null as string | null },
        identity: {
          head: descriptor.head, frameworkSource: descriptor.frameworkSource,
          collectorSha256: plan.freeze.collectorSha256, harnessSha256: plan.freeze.harnessSha256,
          buildReceiptSha256: descriptor.buildReceipt.sha256, containerIdentity: plan.freeze.containerIdentity,
        },
        raw: {
          ...traffic(), label: arm === 'N' ? 'native-bun' : 'fluo-bun', generator,
          warmup: { ...traffic(10_000, 30), generator: { ...generator } },
          coldStart: { processToReadyMs: 1, firstRequest: { ...traffic(1, 1, 1), generator: { ...generator } } },
          servingIdentity: {
            status: 'authenticated', instrumentation: 'none', target: arm === 'N' ? 'native-bun' : 'fluo-bun',
            pid, launcherPid: pid, nonce: `server-${ordinal}`, runtime: { bun: '1.4.2' },
            executableSha256: digest, artifactsSha256: descriptor.targetArtifactsSha256, artifacts: descriptor.artifacts,
            source: { gitHead: descriptor.head, gitStatus: '', benchmarkSourceSha256: digest },
          },
          server: {
            subject: 'server-process-tree', rootPid: pid, method: cpuPrecision.method, wallSeconds: 60,
            cpuSeconds: 2, cpuTimeResolutionSeconds: cpuPrecision.resolutionSeconds, peakRssBytes: 102_400,
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

export function scaleCpu(row: EvidenceFixture['records'][number], factor: number) {
  row.raw.server.cpuSeconds *= factor;
  for (const sample of row.raw.server.samples) for (const process of sample.processes) process.cpuSeconds *= factor;
}
