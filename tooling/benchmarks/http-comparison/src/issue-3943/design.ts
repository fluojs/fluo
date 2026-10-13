export const DESIGN = {
  issue: 3943,
  target: 'fluo-workers',
  configuration: 'default',
  workloads: ['stage-minimal', 'json-command-local'],
  headroom: { connections: 64, workers: [1, 4], pairs: 3, warmupSeconds: 3, captureSeconds: 10 },
  aa: { connections: [1, 64], pairs: 5, warmupSeconds: 10, captureSeconds: 40 },
  gates: {
    minimumCompletions: 10_000, cpuQuantumFraction: 0.01,
    cv: 0.03, pairedMeanDrift: 0.03, tailRssDrift: 0.05, headroomMeanGain: 0.03,
  },
  analysis: { confidence: 0.95, resamples: 10_000, seed: 3943 },
  profiles: {
    modes: ['cpu', 'allocation'], repeats: 2, captures: 8,
    warmupSeconds: 10, controlSeconds: 10, captureSeconds: 20,
    status: 'BLOCKED',
  },
} as const;

export interface Arm {
  readonly phase: 'headroom' | 'aa';
  readonly workload: typeof DESIGN.workloads[number];
  readonly pair: number;
  readonly label: 'A1' | 'A2' | 'one' | 'four';
  readonly workers: number;
  readonly connections: number;
  readonly warmupSeconds: number;
  readonly captureSeconds: number;
}

export function diagnosticArms(): readonly Arm[] {
  const arms: Arm[] = [];
  for (const workload of DESIGN.workloads) {
    for (let pair = 0; pair < DESIGN.headroom.pairs; pair += 1) {
      for (const workers of pair % 2 === 0 ? [1, 4] : [4, 1]) {
        arms.push({
          phase: 'headroom', workload, pair, label: workers === 1 ? 'one' : 'four',
          workers, connections: DESIGN.headroom.connections,
          warmupSeconds: DESIGN.headroom.warmupSeconds, captureSeconds: DESIGN.headroom.captureSeconds,
        });
      }
    }
  }
  for (const workload of DESIGN.workloads) {
    for (const connections of DESIGN.aa.connections) {
      for (let pair = 0; pair < DESIGN.aa.pairs; pair += 1) {
        for (const label of pair % 2 === 0 ? ['A1', 'A2'] as const : ['A2', 'A1'] as const) {
          arms.push({
            phase: 'aa', workload, connections, pair, label, workers: 1,
            warmupSeconds: DESIGN.aa.warmupSeconds, captureSeconds: DESIGN.aa.captureSeconds,
          });
        }
      }
    }
  }
  return arms;
}
