import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { EvidenceJournal } from '../../src/evidence';
import { type CapturePlan, captureCondition, selectProfileTargets } from '../../src/profile';
import { type ProfileCapture, sha256, validateCapture } from '../../src/profile-report';
import { environmentSummary } from '../../src/provenance';
import { SCENARIOS } from '../../src/scenarios';
import { buildTarget, WDIR } from '../../src/targets';

const outputDirectory = process.env.BENCH_WORKERD_PROFILE_OUTPUT;
assert.ok(outputDirectory && !relative(join(WDIR, 'results/issue-3914'), outputDirectory).startsWith('..'));
const targets = selectProfileTargets(['native-workers', 'fluo-workers']);
const scenario = SCENARIOS.find((item) => item.name === 'read-search-local');
assert.ok(scenario);
await mkdir(outputDirectory, { recursive: true });
for (const target of targets) await buildTarget(target);
const environment = await environmentSummary();
const provenanceSha256 = sha256(JSON.stringify(environment));
const captures: ProfileCapture[] = [];
const plan: CapturePlan = {
  targets, scenarios: [scenario], modes: ['cpu'], configuration: 'equivalent',
  connections: 1, repeats: 1, warmupSeconds: 1, durationSeconds: 1, controlSeconds: 1,
  portBase: 36511, inspectorPortBase: 36611, outputDirectory,
};
const journal = new EvidenceJournal(join(outputDirectory, 'receipt.json'), () => ({
  kind: 'bounded-direct-workerd-cpu-linkage', notPerformanceBaseline: true,
  deployed: false, captures, environment, provenanceSha256,
}));
try {
  for (const target of targets) {
    const capture = await captureCondition({
      plan, target, scenario, environment, provenanceSha256, journal,
      condition: { target: target.name, platform: target.platform, scenario: scenario.name,
        configuration: 'equivalent', connections: 1, repeat: 0, mode: 'cpu' },
    });
    captures.push(capture);
    journal.flush();
    assert.equal(capture.status, 'supported');
    assert.ok(capture.subject?.isolateId);
    assert.equal(capture.subject.pid, capture.subject.launcherPid);
    const raw: Map<string, Uint8Array> = new Map(await Promise.all(capture.artifacts.map(async (artifact) =>
      [artifact.path, await readFile(join(outputDirectory, artifact.path))] as const)));
    assert.deepEqual(validateCapture(capture, raw), []);
    console.log(`WORKERD PROFILE PASS ${target.name}`);
  }
} finally { journal.finish(); }
