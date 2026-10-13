import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordinateGeneratedIntegration, summarizeIntegrationMeasurements } from '../../../../.agents/skills/execute-lane/scripts/generated-integration.mjs';
import { decideNext } from '../../../../.agents/skills/execute-lane/scripts/lane-v4.mjs';
import { createPreflight, evaluatePreflight } from '../../../../.agents/skills/issue-preflight/scripts/contracts.mjs';
import { readRetroEvents, recordRetroEvent } from '../../../../.agents/skills/retrospective-lane/scripts/retro.mjs';
import { buildReviewFact } from '../../../../.agents/skills/review-head/scripts/contracts.mjs';
import { generatedHintDigest } from '../../../../.agents/workflow-contracts/contracts.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const requiredStages = ['focused', 'browser', 'review:contract', 'review:code', 'review:verification', 'ci'];
const inputs = {
  initialSource: { target: 'target-v1', first: 'first-v0', second: 'second-v0' },
  changes: [{ issue: 43, key: 'first', value: 'first-v1' }, { issue: 44, key: 'second', value: 'second-v1' }],
  schedule: [{ event: 'initial-conflict', merged: [], at: 0 },
    { event: 'first-merge', merged: [43], at: 10 },
    { event: 'second-merge', merged: [43, 44], at: 20 }],
  finalGateCoverage: requiredStages,
};
const hint = { surface: 'src/generated.ts', issues: [42, 43, 44],
  generated: { command: 'node generator.mjs --check', inputs: [{ path: 'src/source.ts', sha256: hash('source-v0') }],
    issue_evidence: [42, 43, 44].map((issue) => ({ issue, title: 'Source update', body: 'src/source.ts', paths: ['src/source.ts'] })),
    sha256: '' } };
hint.generated.sha256 = generatedHintDigest(hint);

const observed = (issue, head, merged = false) => {
  const preflight = createPreflight({ issue, issue_sha256: hash(`issue-${issue}`), base_sha: hash('base').slice(0, 40),
    scope: ['src/'], non_scope: [], acceptance: ['Preserve generated consumers'],
    validation: ['focused', 'browser', 'selected reviews', 'exact-head CI'], predicted_files: ['src/source.ts'] });
  const obs = { issue, issueSha256: preflight.issue_sha256, baseSha: preflight.base_sha,
    preflight, changedFiles: ['src/source.ts'], headSha: head, branch: merged ? null : `issue-${issue}`,
    worktree: merged ? null : `.worktrees/issue-${issue}`, hasNewCommits: true,
    reviewAcceptedAt: '2026-01-01T00:00:00.000Z',
    pr: { number: issue, state: merged ? 'MERGED' : 'OPEN', headSha: head,
      mergeable: issue === 42 ? 'CONFLICTING' : 'MERGEABLE', ciStatus: 'passing' } };
  const policy = evaluatePreflight(preflight, obs).policy;
  obs.review = buildReviewFact({ head_sha: head, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
    reviews: policy.active_axes.map((reviewer) => ({ reviewer, reviewed_head_sha: head,
      preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [] })) }, head, policy);
  return obs;
};

const runTrace = (coordinated) => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-generated-measure-'));
  const laneId = 'generated-measure';
  const trace = [];
  let head = hash('initial-validation').slice(0, 40);
  const source = { ...inputs.initialSource };
  const recordStages = (runId, stages) => {
    const measurements = stages.map((stage) => ({ runId, attempt: 1, stage, head,
      clock: 'simulation', elapsedMs: null, scope: 'stage-execution' }));
    recordRetroEvent(root, laneId, 42, 'stage', {
      phase: stages.includes('integration') ? 'resolve-conflict' : 'review', head,
      result: { ok: true, head_sha: head, measurements },
    });
    trace.push({ event: 'stage-execution', head, measurements });
  };
  try {
    recordStages('initial-validation', requiredStages);
    for (const event of inputs.schedule) {
      for (const change of inputs.changes.filter((change) => event.merged.includes(change.issue))) {
        source[change.key] = change.value;
      }
      const rows = [42, 43, 44].map((issue) => {
        const obs = observed(issue, issue === 42 ? head : hash(`sibling-${issue}`).slice(0, 40), event.merged.includes(issue));
        return { issue, obs, decision: decideNext({ issue, approvals: { merge: true } }, obs) };
      });
      const decision = (coordinated ? coordinateGeneratedIntegration({ predicted_conflicts: [hint] }, rows) : rows)[0].decision;
      trace.push({ event: event.event, scheduleAt: event.at, clock: 'simulation', head, source: { ...source }, decision });
      recordRetroEvent(root, laneId, 42, 'observation', {
        observationId: event.event, processId: 'simulation-session', clock: 'simulation',
        monotonicMs: event.at, head, action: decision.action,
      });
      if (decision.action !== 'resolve-conflict') continue;
      // Disposable fixture output, not a tracked example. Both modes use the
      // identical deterministic source-to-artifact projection and final inputs.
      const bytes = JSON.stringify(source);
      writeFileSync(join(root, 'generated.txt'), bytes);
      head = hash(`${coordinated}:${event.event}:${bytes}`).slice(0, 40);
      recordStages(`integration-${event.event}`, ['integration', ...requiredStages]);
    }
    const finalSourceSha256 = hash(readFileSync(join(root, 'generated.txt')));
    const finalValidation = trace.filter((event) => event.event === 'stage-execution' && event.head === head)
      .flatMap((event) => event.measurements.map((measurement) => measurement.stage));
    const events = readRetroEvents(root, laneId);
    return { mode: coordinated ? 'AFTER' : 'BEFORE', inputSha256: hash(JSON.stringify(inputs)),
      finalHead: head, finalSourceSha256, finalGateCoverage: finalValidation.filter((stage) => stage !== 'integration').sort(),
      trace, rawEvents: events, report: summarizeIntegrationMeasurements(events, { 42: head }) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** Compare existing per-issue decisions with lane-wide coordination on final source. */
export const runComparison = () => {
  const before = runTrace(false);
  const after = runTrace(true);
  const comparable = before.inputSha256 === after.inputSha256 &&
    before.finalSourceSha256 === after.finalSourceSha256 &&
    JSON.stringify(before.finalGateCoverage) === JSON.stringify(after.finalGateCoverage) &&
    JSON.stringify(after.finalGateCoverage) === JSON.stringify([...requiredStages].sort());
  const countKeys = ['integration', ...requiredStages];
  const workCountComparison = countKeys.some((stage) => after.report.counts[stage] > before.report.counts[stage])
    ? 'worse' : countKeys.some((stage) => after.report.counts[stage] < before.report.counts[stage]) ? 'improved' : 'unchanged';
  return { version: 1, measurementKind: 'deterministic-event-simulation', inputs,
    measurementScope: 'issue-42-generated-integration; sibling merge/CI schedule held constant',
    baseline: 'existing per-issue decideNext', candidate: 'production lane-wide coordinateGeneratedIntegration',
    comparable, workCountComparison, before, after, verdict: 'INCONCLUSIVE',
    reason: 'Stage durations are unknown and simulated event time is not execution elapsed; no speed or CI-budget claim.' };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runComparison();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.comparable) process.exitCode = 1;
}
