import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordinateGeneratedIntegration, coordinatePreflightOverlap } from '../../../../.agents/skills/execute-lane/scripts/generated-integration.mjs';
import { decideNext } from '../../../../.agents/skills/execute-lane/scripts/lane-v4.mjs';
import { createPreflight, evaluatePreflight } from '../../../../.agents/skills/issue-preflight/scripts/contracts.mjs';
import { buildReviewFact } from '../../../../.agents/skills/review-head/scripts/contracts.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = value => digest(value).slice(0, 40);
const axes = ['contract', 'code', 'verification'];
const gates = ['focused', ...axes.map(axis => `review:${axis}`), 'ci'];
const inputs = {
  base: sha('common-base'),
  source: { first: 0, second: 0, independent: 0 },
  changes: [
    { issue: 42, key: 'first', value: 1, predicted_files: ['src/shared.ts'] },
    { issue: 43, key: 'second', value: 1, predicted_files: ['src/shared.ts'] },
    { issue: 44, key: 'independent', value: 1, predicted_files: ['src/independent.ts'] },
  ],
  mergeOrder: [42, 43, 44],
};

const runTrace = coordinated => {
  const source = structuredClone(inputs.source);
  const lane = { preflight_overlap: 1, issues: {} };
  const trace = [];
  const executions = [];
  const observations = inputs.changes.map(change => {
    const preflight = createPreflight({
      issue: change.issue, issue_sha256: digest(change), base_sha: inputs.base,
      scope: ['src/'], non_scope: [], predicted_files: change.predicted_files,
      acceptance: ['Retain final source and exact-head gates'],
      validation: gates, active_axes: axes,
    });
    lane.issues[change.issue] = { issue: change.issue, approvals: { merge: true } };
    return { issue: change.issue, preflight, baseSha: inputs.base, issueSha256: preflight.issue_sha256,
      changedFiles: change.predicted_files, headSha: sha({ base: inputs.base, change }),
      branch: `issue-${change.issue}`, worktree: `.worktrees/issue-${change.issue}`, issueState: 'OPEN',
      hasNewCommits: true, review: null, reviewAcceptedAt: '2026-01-01T00:00:00.000Z', pr: null };
  });
  const initialStateSha256 = digest({ lane, observations, inputs });
  const snapshot = label => {
    const rows = observations.map(obs => ({ issue: obs.issue, obs,
      decision: decideNext(lane.issues[obs.issue], obs) }));
    const legacy = coordinateGeneratedIntegration(lane, rows);
    const decisions = coordinated ? coordinatePreflightOverlap(lane, legacy) : legacy;
    for (const row of decisions) trace.push({ label, issue: row.issue,
      head: row.obs.headSha, clock: 'simulation', decision: structuredClone(row.decision) });
    return decisions;
  };
  const validate = obs => {
    const policy = evaluatePreflight(obs.preflight, obs).policy;
    const review = { head_sha: obs.headSha, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
      reviews: policy.active_axes.map(reviewer => ({
        reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: obs.headSha,
        preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [],
      })) };
    obs.review = buildReviewFact(review, obs.headSha, policy);
    for (const stage of gates.filter(stage => stage !== 'ci')) executions.push({
      issue: obs.issue, head: obs.headSha, stage, runId: `${obs.issue}:${obs.headSha}:${stage}`,
      attempt: 1, clock: 'simulation', duration: null,
    });
    const publication = snapshot('publication').find(row => row.issue === obs.issue).decision;
    assert.ok(['create-pr', 'push'].includes(publication.action), JSON.stringify(publication));
    obs.pr = { number: obs.issue + 100, state: 'OPEN', headSha: obs.headSha,
      mergeable: 'MERGEABLE', ciStatus: 'pending' };
    assert.equal(snapshot('ci-pending').find(row => row.issue === obs.issue).decision.action, 'wait-ci');
    const ci = { issue: obs.issue, head: obs.headSha, stage: 'ci',
      runId: `${obs.issue}:${obs.headSha}:ci`, attempt: 1, clock: 'simulation', duration: null };
    // A repeated observation of the same run must not become another execution.
    executions.push(ci, structuredClone(ci));
    obs.pr.ciStatus = 'passing';
  };
  const initial = snapshot('initial');
  for (const row of initial.filter(row => row.decision.action === 'review')) validate(row.obs);

  let base = inputs.base;
  for (const issue of inputs.mergeOrder) {
    const obs = observations.find(obs => obs.issue === issue);
    let decision = snapshot('before-merge').find(row => row.issue === issue).decision;
    if (decision.action === 'resolve-conflict') {
      obs.headSha = sha({ previous: obs.headSha, integratedBase: base });
      obs.overlapIntegrations = obs.overlapIntegrations.map(evidence => ({ ...evidence, inHead: true }));
      if (obs.pr) obs.pr.mergeable = 'MERGEABLE';
      assert.equal(snapshot('integrated-head').find(row => row.issue === issue).decision.action, 'review');
      validate(obs);
      decision = snapshot('validated-integration').find(row => row.issue === issue).decision;
    }
    assert.equal(decision.action, 'merge', JSON.stringify(decision));
    source[inputs.changes.find(change => change.issue === issue).key] = 1;
    base = sha({ base, issue, head: obs.headSha, source });
    obs.pr.state = 'MERGED';
    obs.pr.mergeCommit = base;
    const remaining = observations.filter(other => other.pr?.state !== 'MERGED' && other.issue !== issue);
    for (const other of remaining) {
      const overlaps = other.preflight.predicted_files.some(file => obs.preflight.predicted_files.includes(file));
      if (!overlaps) continue;
      other.overlapIntegrations = [...(other.overlapIntegrations ?? []),
        { issue, commit: base, base, inBase: true, inHead: false }];
      if (other.pr) other.pr.mergeable = 'CONFLICTING';
    }
    snapshot('sibling-merged');
  }
  const uniqueExecutions = [...new Map(executions.map(run =>
    [`${run.issue}:${run.stage}:${run.runId}:${run.attempt}`, run])).values()];
  const perIssue = Object.fromEntries(observations.map(obs => {
    const runs = uniqueExecutions.filter(run => run.issue === obs.issue);
    const reviewedHeads = [...new Set(runs.filter(run => run.stage.startsWith('review:')).map(run => run.head))].sort();
    const ciRuns = runs.filter(run => run.stage === 'ci').map(({ runId, attempt, head }) => ({ runId, attempt, head }));
    return [obs.issue, { reviewedHeads, reviewedHeadCount: reviewedHeads.length, ciRuns, ciRunCount: ciRuns.length }];
  }));
  const finalGateCoverage = Object.fromEntries(observations.map(obs => [obs.issue,
    [...new Set(uniqueExecutions.filter(run => run.issue === obs.issue && run.head === obs.headSha)
      .map(run => run.stage))].sort()]));
  return { initialStateSha256, trace, executions: uniqueExecutions, perIssue,
    finalSourceSha256: digest(source), finalGateCoverage, clock: 'simulation', duration: null };
};

/** Both sides run the production per-issue and legacy paths on identical inputs. */
export const runComparison = () => {
  const before = runTrace(false);
  const after = runTrace(true);
  const comparable = before.initialStateSha256 === after.initialStateSha256 &&
    before.finalSourceSha256 === after.finalSourceSha256 &&
    JSON.stringify(before.finalGateCoverage) === JSON.stringify(after.finalGateCoverage) &&
    Object.values(after.finalGateCoverage).every(coverage => JSON.stringify(coverage) === JSON.stringify([...gates].sort()));
  return { version: 1, inputs, before, after, comparable, clock: 'simulation', duration: null,
    baseline: 'decideNext -> coordinateGeneratedIntegration',
    candidate: 'decideNext -> coordinateGeneratedIntegration -> coordinatePreflightOverlap',
    verdict: 'INCONCLUSIVE', reason: 'Unknown execution durations; simulation proves work counts, not time savings.' };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runComparison();
  writeFileSync(new URL('./comparison.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ comparable: report.comparable, verdict: report.verdict,
    before: report.before.perIssue, after: report.after.perIssue }, null, 2)}\n`);
  if (!report.comparable) process.exitCode = 1;
}
