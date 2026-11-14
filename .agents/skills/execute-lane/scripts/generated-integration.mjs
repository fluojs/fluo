import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { evaluatePreflight } from '../../issue-preflight/scripts/contracts.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);

/** Only ready, related, independently merge-authorized siblings defer a real conflict. */
export const coordinateGeneratedIntegration = (lane, snapshots) => snapshots.map((row) => {
  const hints = (lane.predicted_conflicts ?? []).filter((hint) =>
    hint.generated && hint.issues.includes(row.issue));
  if (!hints.length || !['resolve-conflict', 'review'].includes(row.decision.action) ||
    row.obs.pr?.state !== 'OPEN' || row.obs.pr.headSha !== row.obs.headSha ||
    row.obs.pr.mergeable !== 'CONFLICTING') return row;
  const ready = snapshots.filter((sibling) => sibling.issue !== row.issue &&
    sibling.decision.action === 'merge' &&
    hints.some((hint) => hint.issues.includes(sibling.issue)));
  if (!ready.length) return { ...row, decision: { action: 'resolve-conflict', pr: row.obs.pr.number } };
  return { ...row, decision: { action: 'wait-generated-integration',
    reason: 'ready-related-sibling', head: row.obs.headSha,
    siblings: ready.map((sibling) => ({ issue: sibling.issue, head: sibling.obs.headSha, pr: sibling.obs.pr.number })),
    surfaces: hints.filter((hint) => ready.some((sibling) => hint.issues.includes(sibling.issue))).map((hint) => hint.surface) } };
});

const readinessActions = new Set(['review', 'create-pr', 'push', 'wait-ci',
  'wait-mergeability', 'request-merge-approval', 'merge']);

/** Shared head/policy admission for pure ordering and transactional CLI recording. */
export const reviewReadinessState = (row) => {
  const preflight = evaluatePreflight(row.obs.preflight, { ...row.obs, issue: row.issue });
  const candidate = preflight.valid && sha(row.obs.headSha) && row.obs.hasNewCommits === true &&
    readinessActions.has(row.decision.action) && !row.obs.observationFailures?.length &&
    row.obs.issueState !== 'CLOSED' && !['CLOSED', 'MERGED'].includes(row.obs.pr?.state);
  const fact = row.obs.facts?.['review-readiness'];
  const current = candidate && fact?.head === row.obs.headSha && fact.value?.active === true &&
    fact.value.policy_sha256 === preflight.policy.sha256 &&
    Number.isSafeInteger(fact.value.sequence) && fact.value.sequence > 0;
  return { candidate, current: Boolean(current), policy: preflight.valid ? preflight.policy : null,
    sequence: current ? fact.value.sequence : null };
};

/** Accepted predictions coordinate review entry using already returned grants. */
export const coordinatePreflightOverlap = (lane, snapshots) => {
  if (lane.preflight_overlap !== 1) return snapshots;
  const policies = new Map(snapshots.map((row) => [row.issue,
    evaluatePreflight(row.obs.preflight, { ...row.obs, issue: row.issue })]));
  const overlaps = (left, right) => policies.get(left.issue).valid && policies.get(right.issue).valid
    ? [...new Set(left.obs.preflight.predicted_files.filter(file =>
      right.obs.preflight.predicted_files.includes(file)))].sort() : [];
  const readiness = new Map(snapshots.map(row => [row.issue, reviewReadinessState(row)]));
  const candidates = snapshots.filter(row => readiness.get(row.issue).candidate)
    .sort((a, b) => Number(readiness.get(b.issue).current) - Number(readiness.get(a.issue).current) ||
      (readiness.get(a.issue).sequence ?? 0) - (readiness.get(b.issue).sequence ?? 0) || a.issue - b.issue);
  const selected = [];
  for (const candidate of candidates) {
    if (!selected.some(other => overlaps(candidate, other).length)) selected.push(candidate);
  }
  return snapshots.map(row => {
    const related = snapshots.filter(sibling => sibling.issue !== row.issue && overlaps(row, sibling).length)
      .sort((a, b) => a.issue - b.issue);
    if (!related.length) return row;
    const targets = related.map(sibling => ({
      issue: sibling.issue, head: sibling.obs.headSha, pr: sibling.obs.pr?.number ?? null,
      files: overlaps(row, sibling), state: sibling.decision.action,
    }));
    const decision = { ...row.decision, overlaps: targets };
    if (row.decision.action !== 'review') return { ...row, decision };
    const merged = related.filter(sibling => sibling.obs.pr?.state === 'MERGED');
    const integrations = merged.map(sibling => ({
      sibling, evidence: row.obs.overlapIntegrations?.find(item => item.issue === sibling.issue),
    }));
    const unreadable = integrations.filter(({ sibling, evidence }) =>
      !sha(sibling.obs.pr.mergeCommit) || evidence?.commit !== sibling.obs.pr.mergeCommit ||
      !sha(evidence?.base) || evidence.inBase !== true || typeof evidence.inHead !== 'boolean');
    if (unreadable.length) return { ...row, decision: { action: 'observation-failed', overlaps: targets,
      failures: unreadable.map(({ sibling }) => ({
        source: 'preflight-overlap', subject: sibling.issue, code: 'merge-ancestry-unavailable',
      })) } };
    const waiting = selected.filter(sibling => sibling.issue !== row.issue && overlaps(row, sibling).length);
    if (!selected.some(sibling => sibling.issue === row.issue) && waiting.length) {
      const siblings = targets.filter(target => waiting.some(sibling => sibling.issue === target.issue));
      return { ...row, decision: { action: 'wait-preflight-overlap', reason: 'selected-overlapping-sibling',
        head: row.obs.headSha, siblings, files: [...new Set(siblings.flatMap(sibling => sibling.files))].sort(),
        overlaps: targets } };
    }
    const missing = integrations.filter(({ evidence }) => !evidence.inHead);
    if (missing.length) return { ...row, decision: { action: 'resolve-conflict',
      reason: 'preflight-overlap-base-integration', head: row.obs.headSha,
      base: missing[0].evidence.base, ...(row.obs.pr ? { pr: row.obs.pr.number } : {}),
      siblings: missing.map(({ sibling, evidence }) => ({ issue: sibling.issue, commit: evidence.commit })),
      overlaps: targets } };
    return { ...row, decision };
  });
};

const normalizeFingerprint = (bytes) => bytes.replace(/("sourceFingerprint"\s*:\s*")[a-f0-9]{64}(")/gu, '$1<FINGERPRINT>$2');
const evidenceFile = (root, path) => {
  if (typeof path !== 'string' || path.includes('\\') || path.split('/').includes('..')) {
    throw new TypeError('Generated integration evidence path is invalid');
  }
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${resolve(root)}${sep}`) ||
    !realpathSync(absolute).startsWith(`${realpathSync(root)}${sep}`)) {
    throw new TypeError('Generated integration evidence escapes worktree');
  }
  return readFileSync(absolute);
};

/**
 * Admit only exact-head generation, complete byte equality and focused/browser
 * evidence. Admission runs the canonical read-only generation check; subsequent
 * observations revalidate immutable evidence without running suites.
 */
export const validateGeneratedIntegration = (root, context, value) => {
  if (!exact(value, ['head', 'outputs', 'checks']) || !sha(value.head) ||
    value.head !== context.head || !Array.isArray(value.outputs) || !Array.isArray(value.checks) ||
    value.outputs.length !== context.hints.length) throw new TypeError('Generated integration requires current-head receipt');
  for (const hint of context.hints) {
    const outputs = value.outputs.filter((output) => output.surface === hint.surface);
    if (outputs.length !== 1) throw new TypeError('Generated integration must cover every consumer once');
    const output = outputs[0];
    if (!exact(output, ['surface', 'expectedPath', 'expectedSha256', 'artifactSha256', 'command', 'exitCode', 'normalizeSourceFingerprint']) ||
      output.command !== hint.generated.command || output.exitCode !== 0 ||
      typeof output.normalizeSourceFingerprint !== 'boolean' ||
      !output.expectedPath?.startsWith('.omo/generated-integration/')) {
      throw new TypeError('Missing authoritative generated output');
    }
    const expected = evidenceFile(root, output.expectedPath);
    const artifact = evidenceFile(root, hint.surface);
    if (digest(expected) !== output.expectedSha256 || digest(artifact) !== output.artifactSha256) {
      throw new TypeError('Generated integration output digest mismatch');
    }
    const normalize = output.normalizeSourceFingerprint ? normalizeFingerprint : (text) => text;
    if (normalize(expected.toString('utf8')) !== normalize(artifact.toString('utf8'))) {
      throw new TypeError('Generated integration full byte equality failed');
    }
    if (context.execute) {
      execFileSync('/bin/sh', ['-c', hint.generated.command], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
      });
    }
  }
  for (const kind of ['focused', 'browser']) {
    if (!value.checks.some((check) => check.kind === kind)) throw new TypeError(`Missing generated integration ${kind} checks`);
  }
  for (const check of value.checks) {
    if (!exact(check, ['kind', 'head', 'command', 'exitCode', 'logPath', 'logSha256']) ||
      !['focused', 'browser'].includes(check.kind) || check.head !== context.head ||
      typeof check.command !== 'string' || !check.command.trim() || check.exitCode !== 0 ||
      !check.logPath?.startsWith('.omo/generated-integration/') ||
      digest(evidenceFile(root, check.logPath)) !== check.logSha256) {
      throw new TypeError('Generated integration checks are stale, incomplete or tampered');
    }
  }
  return value;
};

const stages = ['integration', 'focused', 'browser', 'review:contract', 'review:code', 'review:verification', 'ci'];

/** Measured work units retain clock, scope and run identity independently of recordedAt. */
export const validateStageMeasurements = (measurements, head) => {
  if (measurements === undefined) return;
  if (!Array.isArray(measurements) || measurements.length === 0) throw new TypeError('Missing stage measurements');
  const ids = new Set();
  for (const measurement of measurements) {
    if (!exact(measurement, ['runId', 'attempt', 'stage', 'head', 'clock', 'elapsedMs', 'scope']) ||
      typeof measurement.runId !== 'string' || !measurement.runId.trim() ||
      !Number.isSafeInteger(measurement.attempt) || measurement.attempt < 1 ||
      !stages.includes(measurement.stage) || !sha(measurement.head) || measurement.head !== head ||
      !['monotonic', 'simulation'].includes(measurement.clock) || measurement.scope !== 'stage-execution' ||
      (measurement.elapsedMs !== null && (!Number.isFinite(measurement.elapsedMs) || measurement.elapsedMs < 0))) {
      throw new TypeError('Invalid stage measurement identity, duration or scope');
    }
    const id = `${measurement.runId}:${measurement.attempt}:${measurement.stage}`;
    if (ids.has(id)) throw new TypeError('Duplicate stage measurement');
    ids.add(id);
  }
};

/** Counts and scoped durations come from actual recorder/observation inputs, never timestamps. */
export const summarizeIntegrationMeasurements = (events, finalHeads = {}) => {
  const units = new Map();
  const unknowns = [];
  for (const event of events) {
    if (event.kind === 'ci' && Object.hasOwn(event.data ?? {}, 'conclusion')) {
      const { run, elapsedMs, elapsedScope } = event.data;
      if (!Number.isSafeInteger(run?.id) || run.id < 1 || !Number.isSafeInteger(run.attempt) ||
        run.attempt < 1 || !sha(run.head) || !['initial-run-including-queue', 'retry-attempt-excluding-queue'].includes(elapsedScope) ||
        (elapsedMs !== null && (!Number.isFinite(elapsedMs) || elapsedMs < 0))) {
        unknowns.push({ eventId: event.eventId, reason: 'invalid-ci-measurement' });
        continue;
      }
      const measurement = { runId: String(run.id), attempt: run.attempt, stage: 'ci', head: run.head,
        clock: 'github-actions', elapsedMs, scope: elapsedScope };
      units.set(`${event.issue}:${run.id}:${run.attempt}:ci`, { issue: event.issue, eventId: event.eventId, measurement });
      if (elapsedMs === null) unknowns.push({ eventId: event.eventId, reason: 'missing-ci-duration' });
      continue;
    }
    if (event.kind !== 'stage') continue;
    const measurements = event.data?.result?.measurements;
    if (!measurements) {
      unknowns.push({ eventId: event.eventId, reason: 'stage-duration-and-execution-count-unavailable' });
      continue;
    }
    try {
      validateStageMeasurements(measurements, event.data.head);
    } catch {
      unknowns.push({ eventId: event.eventId, reason: 'invalid-measurement' });
      continue;
    }
    for (const measurement of measurements) {
      const key = `${event.issue}:${measurement.runId}:${measurement.attempt}:${measurement.stage}`;
      if (units.has(key) && JSON.stringify(units.get(key).measurement) !== JSON.stringify(measurement)) {
        unknowns.push({ eventId: event.eventId, reason: 'conflicting-run-identity' });
        continue;
      }
      units.set(key, { issue: event.issue, eventId: event.eventId, measurement });
      if (measurement.elapsedMs === null) unknowns.push({ eventId: event.eventId, reason: 'missing-duration' });
    }
  }
  const runs = [...units.values()];
  if (!runs.length) unknowns.push({ eventId: null, reason: 'measurement-history-unavailable' });
  const counts = Object.fromEntries(stages.map((stage) => [stage, runs.filter((run) => run.measurement.stage === stage).length]));
  const superseded = new Set(runs.filter(({ issue, measurement }) =>
    measurement.stage !== 'integration' && finalHeads[issue] && measurement.head !== finalHeads[issue])
    .map(({ issue, measurement }) => `${issue}:${measurement.head}`));
  const waits = { dependency: [], coordination: [] };
  const observations = events.filter((event) => {
    if (event.kind !== 'observation') return false;
    if (!['monotonic', 'simulation'].includes(event.data?.clock) ||
      typeof event.data.processId !== 'string' || !event.data.processId ||
      !Number.isFinite(event.data.monotonicMs) || event.data.monotonicMs < 0) {
      unknowns.push({ eventId: event.eventId, reason: 'invalid-observation-clock-or-identity' });
      return false;
    }
    return true;
  });
  const groups = Map.groupBy(observations, (event) => `${event.issue}:${event.data.processId}`);
  for (const group of groups.values()) {
    group.sort((a, b) => a.data.monotonicMs - b.data.monotonicMs);
    for (let index = 0; index < group.length; index++) {
      const event = group[index];
      const kind = event.data.action === 'wait-dependencies' ? 'dependency'
        : event.data.action === 'wait-generated-integration' ? 'coordination' : null;
      if (!kind) continue;
      const next = group[index + 1];
      const elapsedMs = next && Number.isFinite(event.data.monotonicMs) && Number.isFinite(next.data.monotonicMs)
        ? next.data.monotonicMs - event.data.monotonicMs : null;
      waits[kind].push({ issue: event.issue, head: event.data.head, eventId: event.eventId,
        clock: event.data.clock, elapsedMs, scope: 'observed-wait' });
      if (elapsedMs === null) unknowns.push({ eventId: event.eventId, reason: 'wait-end-unobserved-or-restarted' });
    }
  }
  const simulation = runs.some((run) => run.measurement.clock === 'simulation') ||
    observations.some((event) => event.data.clock === 'simulation');
  return { counts, runs, supersededValidationHeads: superseded.size, waits,
    status: unknowns.length || simulation ? 'inconclusive' : 'complete',
    simulation, unknowns, totalElapsedMs: null };
};
