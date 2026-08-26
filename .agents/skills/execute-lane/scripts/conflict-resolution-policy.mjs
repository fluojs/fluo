import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { requireRecord, requireSha, requireString } from './transition-contracts.mjs';
import { remediateCurrentBlockers } from './blocker-ledger.mjs';
import {
  REVIEW_SENTINEL,
  verifyConflictGateTask,
  verifyReviewerTask,
} from './reviewer-runtime.mjs';
import { verifyConflictImplementerRuntime } from './implementer-runtime.mjs';

const axes = ['contract', 'code', 'verification'];
const impacts = new Set(['mechanical', 'scoped', 'ambiguous', 'cross-cutting']);
const sha256 = /^[a-f0-9]{64}$/u;

const uniqueStrings = (value, name, allowEmpty = false) => {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(`${name} must contain unique non-empty strings.`);
  }
  return [...value];
};

const provenance = (state) => ({
  repository_root: state.repository_root,
  parent_session_id: state.parent_session_id,
  lane_id: state.lane_id,
  issue_number: state.issue_number,
  worktree: state.worktree,
  branch: state.branch,
});

export const assertMachineConflictScope = (gate, machineEvidence) => {
  const minimumAxes = uniqueStrings(
    machineEvidence.classifier?.minimum_affected_axes,
    'conflict machine minimum affected axes',
  );
  if (
    machineEvidence.upstream_overlap !== gate.upstream_relevant ||
    (gate.semantic_impact === 'mechanical' && machineEvidence.mechanical_inheritance_eligible !== true) ||
    (gate.semantic_impact !== 'mechanical' && minimumAxes.some((axis) => !gate.affected_axes.includes(axis)))
  ) {
    throw new TypeError('reviewer conflict classification cannot omit or override canonical Git minimum impact.');
  }
  return minimumAxes;
};

const receiptMatches = (actual, expected, message) => {
  if (payloadDigest(actual) !== payloadDigest(expected)) {
    throw new TypeError(message);
  }
  return structuredClone(expected);
};

const requirePassReceipt = (state, receipt, axis, headSha, preflightSha256) => {
  const value = requireRecord(receipt, `conflict resolution ${axis} reviewer receipt`);
  const verified = verifyReviewerTask({
    ...provenance(state),
    task_id: value.task_id,
    head_sha: headSha,
    preflight_sha256: preflightSha256,
    axis,
  });
  receiptMatches(
    value,
    verified,
    `conflict resolution ${axis} receipt does not match its canonical reviewer task.`,
  );
  const output = verified.final_response;
  const rowIds = state.review_preflight.acceptance_row_ids;
  if (
    preflightSha256 !== state.review_preflight.sha256 ||
    output.verdict_signal !== 'PASS' ||
    output.blockers.length !== 0 ||
    Object.keys(output.blocker_sources).length !== 0 ||
    Object.keys(output.coverage).length !== rowIds.length ||
    rowIds.some((rowId) => output.coverage[rowId] !== 'PASS')
  ) {
    throw new TypeError(`conflict resolution ${axis} reviewer output is not a complete PASS.`);
  }
  return verified;
};

const requirePriorPasses = (state) => {
  const review = state.local_review;
  if (
    review === null ||
    review.lane_id !== state.lane_id ||
    review.issue_number !== state.issue_number ||
    review.head_sha !== state.head_sha ||
    review.version !== 2 ||
    review.review_batch?.preflight_sha256 !== state.review_preflight?.sha256 ||
    !axes.every((axis) => review.reviewers[axis] === 'PASS') ||
    !Array.isArray(review.reviews) ||
    !axes.every((axis) =>
      review.reviews.some(
        (result) =>
          result.reviewer === axis &&
          result.reviewed_head_sha === state.head_sha &&
          result.verdict_signal === 'PASS' &&
          Array.isArray(result.blockers) &&
          result.blockers.length === 0,
      ),
    )
  ) {
    throw new TypeError('conflict resolution requires exact-head prior axis PASS evidence.');
  }
  return Object.fromEntries(
    axes.map((axis) => {
      const persisted = review.review_batch.reviewer_receipts?.[axis];
      const verified = requirePassReceipt(
        state,
        persisted,
        axis,
        state.head_sha,
        review.review_batch.preflight_sha256,
      );
      return [axis, verified];
    }),
  );
};

const requireGate = (state, step, previousHead) => {
  const gate = requireRecord(step.gate, 'conflict resolution gate');
  const resolvedHead = requireSha(gate.resolved_head, 'conflict resolved head');
  const upstreamHead = requireSha(gate.upstream_head, 'conflict upstream head');
  if (
    requireSha(gate.previously_reviewed_head, 'conflict previously reviewed head') !== previousHead ||
    resolvedHead === previousHead ||
    gate.preflight_sha256 !== state.review_preflight.sha256
  ) {
    throw new TypeError('conflict resolution heads and preflight must bind the persisted review.');
  }
  if (!impacts.has(gate.semantic_impact) || typeof gate.upstream_relevant !== 'boolean') {
    throw new TypeError('conflict resolution semantic impact is invalid.');
  }
  const conflictingFiles = uniqueStrings(gate.conflicting_files, 'conflict resolution conflicting_files');
  const conflictingHunks = uniqueStrings(gate.conflicting_hunks, 'conflict resolution conflicting_hunks');
  const affectedAxes = uniqueStrings(gate.affected_axes, 'conflict resolution affected_axes', true);
  if (affectedAxes.some((axis) => !axes.includes(axis))) {
    throw new TypeError('conflict resolution affected axes are invalid.');
  }
  requireString(gate.rationale, 'conflict resolution rationale');
  if (
    (gate.semantic_impact === 'mechanical' && (affectedAxes.length !== 0 || gate.upstream_relevant)) ||
    (gate.semantic_impact === 'scoped' && affectedAxes.length === 0) ||
    (['ambiguous', 'cross-cutting'].includes(gate.semantic_impact) &&
      (affectedAxes.length !== axes.length || !axes.every((axis) => affectedAxes.includes(axis))))
  ) {
    throw new TypeError('conflict resolution impact classification does not match its rerun scope.');
  }
  const canonical = {
    preflight_sha256: gate.preflight_sha256,
    previously_reviewed_head: previousHead,
    upstream_head: upstreamHead,
    resolved_head: resolvedHead,
    conflicting_files: conflictingFiles,
    conflicting_hunks: conflictingHunks,
    semantic_impact: gate.semantic_impact,
    upstream_relevant: gate.upstream_relevant,
    affected_axes: affectedAxes,
    rationale: gate.rationale,
  };
  const receipt = verifyConflictGateTask({
    ...provenance(state),
    task_id: step.gate_task_id,
    gate: canonical,
  });
  return { canonical, receipt };
};

const rerunEvidence = (state, step, affectedAxes, resolvedHead) => {
  if (Object.hasOwn(step, 'rerun_reviews')) {
    throw new TypeError('conflict resolution does not accept caller-provided rerun reviews.');
  }
  const taskIds = requireRecord(step.rerun_task_ids, 'conflict rerun task IDs');
  if (
    Object.keys(taskIds).length !== affectedAxes.length ||
    affectedAxes.some((axis) => typeof taskIds[axis] !== 'string') ||
    new Set(Object.values(taskIds)).size !== affectedAxes.length
  ) {
    throw new TypeError('conflict resolution must rerun every affected axis exactly once.');
  }
  return affectedAxes.map((axis) => {
    const verified = verifyReviewerTask({
      ...provenance(state),
      task_id: taskIds[axis],
      head_sha: resolvedHead,
      preflight_sha256: state.review_preflight.sha256,
      axis,
    });
    requirePassReceipt(
      state,
      verified,
      axis,
      resolvedHead,
      state.review_preflight.sha256,
    );
    return {
      axis,
      kind: 'rerun',
      reviewed_head_sha: resolvedHead,
      preflight_sha256: state.review_preflight.sha256,
      pr_number: state.pr.number,
      pr_url: state.pr.url,
      receipt: verified,
    };
  });
};

const reconcileConflictBlocker = (state, resolvedHead) => {
  const current = state.blockers.filter(
    (blocker) => blocker.signature === 'pr:merge-conflict' && blocker.status === 'unresolved',
  );
  if (
    state.blockers.length !== 1 ||
    current.length !== 1 ||
    current[0].evidence !== state.conflict_receipt.evidence
  ) {
    throw new TypeError('conflict resolution requires the unresolved persisted PR-conflict blocker.');
  }
  remediateCurrentBlockers(state, current, resolvedHead, {
    kind: 'conflict-resolved',
    conflict_receipt_sha256: payloadDigest(state.conflict_receipt),
  });
  state.blockers = [];
};

export const applyConflictResolution = (state, step) => {
  if (
    state.status !== 'conflict-resolution' ||
    state.conflict_receipt === null ||
    state.conflict_receipt.head_sha !== state.head_sha
  ) {
    throw new TypeError('conflict resolution requires a persisted conflicting PR receipt.');
  }
  const previousHead = state.head_sha;
  const prior = requirePriorPasses(state);
  const { canonical: gate, receipt: gateReceipt } = requireGate(state, step, previousHead);
  const machineEvidence = step.machine_evidence === undefined
    ? null
    : requireRecord(step.machine_evidence, 'conflict machine evidence');
  let implementerReceipt = null;
  if (machineEvidence !== null) {
    assertMachineConflictScope(gate, machineEvidence);
    const usedTaskIds = new Set([
      ...state.implementer_tasks.map(({ task_id: taskId }) => taskId),
      step.gate_task_id,
      ...Object.values(requireRecord(step.rerun_task_ids, 'conflict rerun task IDs')),
    ]);
    if (usedTaskIds.has(step.conflict_implementer_task_id)) {
      throw new TypeError('conflict implementer task must be distinct and cannot be reused.');
    }
    implementerReceipt = verifyConflictImplementerRuntime({
      ...provenance(state),
      task_id: step.conflict_implementer_task_id,
      old_base: machineEvidence.old_base,
      previously_reviewed_head: previousHead,
      upstream_head: gate.upstream_head,
      resolved_head: gate.resolved_head,
      generation: state.implementer_generation,
      preflight_sha256: state.review_preflight.sha256,
    });
  }
  const mustRerun = ['ambiguous', 'cross-cutting'].includes(gate.semantic_impact)
    ? axes
    : gate.affected_axes;
  const rerun = rerunEvidence(state, step, mustRerun, gate.resolved_head);
  const rerunByAxis = new Map(rerun.map((evidence) => [evidence.axis, evidence]));
  const inherited = axes
    .filter((axis) => !rerunByAxis.has(axis))
    .map((axis) => ({
      axis,
      kind: 'inherited',
      reviewed_head_sha: previousHead,
      preflight_sha256: state.review_preflight.sha256,
      pr_number: state.pr.number,
      pr_url: state.pr.url,
      receipt: structuredClone(prior[axis]),
    }));
  reconcileConflictBlocker(state, gate.resolved_head);
  const historicalConflictReceipt = structuredClone(state.conflict_receipt);
  state.head_sha = gate.resolved_head;
  state.ci = null;
  state.conflict_resolution = {
    ...gate,
    machine_evidence: machineEvidence === null ? null : structuredClone(machineEvidence),
    implementer_receipt: implementerReceipt,
    digests: structuredClone(gateReceipt.final_response.digests),
    conflict_receipt: historicalConflictReceipt,
    conflict_receipt_sha256: payloadDigest(historicalConflictReceipt),
    gate_receipt: gateReceipt,
    axes: axes.map((axis) => rerunByAxis.get(axis) ?? inherited.find((item) => item.axis === axis)),
  };
  state.conflict_receipt = null;
  state.status = 'ready-for-push';
};

export const assertConflictResolutionEvidence = (state) => {
  const resolution = requireRecord(state.conflict_resolution, 'conflict resolution evidence');
  const previousHead = requireSha(resolution.previously_reviewed_head, 'conflict resolution previously reviewed head');
  const resolvedHead = requireSha(resolution.resolved_head, 'conflict resolution resolved head');
  requireSha(resolution.upstream_head, 'conflict resolution upstream head');
  if (
    previousHead === resolvedHead ||
    resolution.preflight_sha256 !== state.review_preflight?.sha256
  ) {
    throw new TypeError('conflict resolution evidence must bind distinct old/current heads and preflight.');
  }
  const gate = {
    preflight_sha256: resolution.preflight_sha256,
    previously_reviewed_head: previousHead,
    upstream_head: resolution.upstream_head,
    resolved_head: resolvedHead,
    conflicting_files: uniqueStrings(resolution.conflicting_files, 'conflict resolution conflicting_files'),
    conflicting_hunks: uniqueStrings(resolution.conflicting_hunks, 'conflict resolution conflicting_hunks'),
    semantic_impact: resolution.semantic_impact,
    upstream_relevant: resolution.upstream_relevant,
    affected_axes: uniqueStrings(resolution.affected_axes, 'conflict resolution affected_axes', true),
    rationale: requireString(resolution.rationale, 'conflict resolution rationale'),
  };
  if (!impacts.has(gate.semantic_impact) || typeof gate.upstream_relevant !== 'boolean') {
    throw new TypeError('conflict resolution semantic impact is invalid.');
  }
  const verifiedGate = verifyConflictGateTask({
    ...provenance(state),
    task_id: resolution.gate_receipt?.task_id,
    gate,
  });
  receiptMatches(
    resolution.gate_receipt,
    verifiedGate,
    'conflict resolution gate receipt does not match its canonical reviewer task.',
  );
  if (
    payloadDigest(resolution.digests) !== payloadDigest(verifiedGate.final_response.digests) ||
    !sha256.test(resolution.conflict_receipt_sha256 ?? '') ||
    payloadDigest(resolution.conflict_receipt) !== resolution.conflict_receipt_sha256 ||
    resolution.conflict_receipt?.head_sha !== previousHead ||
    resolution.conflict_receipt?.kind !== 'pr-conflict'
  ) {
    throw new TypeError('conflict resolution gate digests or historical conflict receipt are invalid.');
  }
  if (!Array.isArray(resolution.axes) || resolution.axes.length !== axes.length) {
    throw new TypeError('conflict resolution axis evidence is incomplete.');
  }
  const seenTasks = new Set([verifiedGate.task_id]);
  if (resolution.machine_evidence !== null && resolution.machine_evidence !== undefined) {
    const verifiedImplementer = verifyConflictImplementerRuntime({
      ...provenance(state),
      task_id: resolution.implementer_receipt?.task_id,
      old_base: resolution.machine_evidence.old_base,
      previously_reviewed_head: previousHead,
      upstream_head: gate.upstream_head,
      resolved_head: resolvedHead,
      generation: state.implementer_generation,
      preflight_sha256: state.review_preflight.sha256,
    });
    receiptMatches(
      resolution.implementer_receipt,
      verifiedImplementer,
      'conflict resolution implementer receipt does not match its canonical task.',
    );
    if (
      seenTasks.has(verifiedImplementer.task_id) ||
      state.implementer_tasks.some(({ task_id: taskId }) => taskId === verifiedImplementer.task_id)
    ) throw new TypeError('conflict resolution implementer task was reused.');
    seenTasks.add(verifiedImplementer.task_id);
  }
  let rerunCount = 0;
  for (const axis of axes) {
    const evidence = requireRecord(
      resolution.axes.find((candidate) => candidate?.axis === axis),
      'conflict resolution axis evidence',
    );
    const expectedKind = gate.affected_axes.includes(axis) ? 'rerun' : 'inherited';
    const expectedHead = expectedKind === 'rerun' ? resolvedHead : previousHead;
    if (
      evidence.kind !== expectedKind ||
      evidence.reviewed_head_sha !== expectedHead ||
      evidence.preflight_sha256 !== gate.preflight_sha256 ||
      evidence.pr_number !== state.pr?.number ||
      evidence.pr_url !== state.pr?.url ||
      evidence.pr_number !== resolution.conflict_receipt.pr_number ||
      evidence.pr_url !== resolution.conflict_receipt.pr_url ||
      evidence.receipt?.mutation_sentinel !== REVIEW_SENTINEL ||
      seenTasks.has(evidence.receipt?.task_id)
    ) {
      throw new TypeError('conflict resolution axis evidence is invalid.');
    }
    requirePassReceipt(state, evidence.receipt, axis, expectedHead, evidence.preflight_sha256);
    if (
      expectedKind === 'inherited' &&
      state.local_review?.head_sha === previousHead &&
      payloadDigest(evidence.receipt) !==
        payloadDigest(state.local_review.review_batch.reviewer_receipts[axis])
    ) {
      throw new TypeError('conflict resolution inherited evidence is not the exact prior PASS receipt.');
    }
    seenTasks.add(evidence.receipt.task_id);
    if (expectedKind === 'rerun') rerunCount += 1;
  }
  if (
    (gate.semantic_impact === 'mechanical' && (rerunCount !== 0 || gate.upstream_relevant)) ||
    (gate.semantic_impact === 'scoped' && rerunCount === 0) ||
    (['ambiguous', 'cross-cutting'].includes(gate.semantic_impact) && rerunCount !== axes.length)
  ) {
    throw new TypeError('conflict resolution axis evidence does not match semantic impact.');
  }
  const historicalBlockers = state.blocker_ledger.filter(
    (entry) =>
      entry.blocker.signature === 'pr:merge-conflict' &&
      entry.blocker.evidence === resolution.conflict_receipt.evidence,
  );
  if (
    state.blockers.some((blocker) => blocker.signature === 'pr:merge-conflict') ||
    historicalBlockers.length !== 1 ||
    historicalBlockers[0].remediation_status !== 'remediated'
  ) {
    throw new TypeError('resolved conflict state retains an unresolved blocker or invalid history.');
  }
  return resolution;
};

export const hasResolvedHeadPasses = (state) => {
  if (
    state.conflict_resolution === null ||
    state.conflict_resolution.resolved_head !== state.head_sha
  ) return false;
  try {
    assertConflictResolutionEvidence(state);
    return true;
  } catch {
    return false;
  }
};
