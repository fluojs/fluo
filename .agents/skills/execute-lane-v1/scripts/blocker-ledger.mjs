import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import {
  CONFLICT_REVIEW_SENTINEL,
  REVIEW_SENTINEL,
  verifyReviewerTask,
} from './reviewer-runtime.mjs';
import {
  coordinatorSessionIds,
  currentCoordinatorSessionId,
} from './issue-supervisor-contracts.mjs';

const axes = new Set(['contract', 'code', 'verification']);
const reasons = new Set([
  'correctness',
  'security',
  'compatibility',
  'required-verification',
]);
const sha256 = /^[a-f0-9]{64}$/u;

const requireRecord = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const immutableEntry = (entry) => ({
  version: entry.version,
  sequence: entry.sequence,
  blocker: entry.blocker,
  reviewed_head_sha: entry.reviewed_head_sha,
  implementer_generation: entry.implementer_generation,
  reviewer_axis: entry.reviewer_axis,
  reviewer_receipt: entry.reviewer_receipt,
  preflight_sha256: entry.preflight_sha256,
  preflight_row_id: entry.preflight_row_id,
  approved_contract_source: entry.approved_contract_source,
  approved_contract_revision: entry.approved_contract_revision,
  reproduction: entry.reproduction,
  blocking_reason: entry.blocking_reason,
  observed_event_sequence: entry.observed_event_sequence,
  evidence_kind: entry.evidence_kind,
  evidence_sha256: entry.evidence_sha256,
  evidence_receipt: entry.evidence_receipt,
});

export const blockerLedgerDigest = (ledger) => payloadDigest(ledger);

const reviewerProvenance = (state, taskId, headSha, axis) => ({
  repository_root: state.repository_root,
  parent_session_id: currentCoordinatorSessionId(state),
  lane_id: state.lane_id,
  issue_number: state.issue_number,
  worktree: state.worktree,
  branch: state.branch,
  task_id: taskId,
  head_sha: headSha,
  preflight_sha256: state.review_preflight.sha256,
  axis,
});

const canonicalReceipt = (receipt) => ({
  task_id: receipt.task_id,
  record_sha256: receipt.record_sha256,
  output_sha256: receipt.output_sha256,
  final_response: structuredClone(receipt.final_response),
  parent_session_id: receipt.parent_session_id,
  dag_run_id: receipt.dag_run_id,
  dag_key: receipt.dag_key,
  dag_node_id: receipt.dag_node_id,
  dag_owner_fingerprint: receipt.dag_owner_fingerprint,
  lane_id: receipt.lane_id,
  issue_number: receipt.issue_number,
  worktree: receipt.worktree,
  head_sha: receipt.head_sha,
  preflight_sha256: receipt.preflight_sha256,
  axis: receipt.axis,
  mutation_sentinel: receipt.mutation_sentinel,
  session_sha256: receipt.session_sha256,
  tool_events_sha256: receipt.tool_events_sha256,
  tool_events: structuredClone(receipt.tool_events),
  canonical_verification: structuredClone(receipt.canonical_verification),
});

const compositeVerificationReceipt = (state) => {
  const source = state.conflict_resolution.axes.find(
    (axis) => axis.axis === 'verification',
  ).receipt;
  const gate = state.conflict_resolution.gate_receipt;
  const output = {
    sentinel: 'fluo:execute-lane:conflict-verification:composite:v1',
    head_sha: state.head_sha,
    source_head_sha: source.head_sha,
    source_receipt_sha256: payloadDigest(source),
    conflict_gate_receipt_sha256: payloadDigest(gate),
  };
  return {
    task_id: gate.task_id,
    record_sha256: payloadDigest({ gate, source }),
    output_sha256: payloadDigest(output),
    final_response: output,
    parent_session_id: currentCoordinatorSessionId(state),
    lane_id: state.lane_id,
    issue_number: state.issue_number,
    worktree: state.worktree,
    head_sha: state.head_sha,
    axis: 'verification',
    mutation_sentinel: CONFLICT_REVIEW_SENTINEL,
  };
};

const makeEntry = (state, input) => {
  const sequence = state.blocker_ledger.length + 1;
  const observedEventSequence =
    input.observedEventSequence ?? sequence;
  const base = {
    version: 1,
    sequence,
    blocker: structuredClone(input.blocker),
    reviewed_head_sha: input.reviewedHead,
    implementer_generation: state.implementer_generation,
    reviewer_axis: input.axis,
    reviewer_receipt: canonicalReceipt(input.receipt),
    preflight_sha256: state.review_preflight.sha256,
    preflight_row_id: input.source.violated_invariant,
    approved_contract_source: input.source.contract_source,
    approved_contract_revision: state.review_preflight.approved_sources.find(
      (candidate) => candidate.source === input.source.contract_source,
    ).revision,
    reproduction: input.source.reproduction,
    blocking_reason: input.source.why_blocking,
    observed_event_sequence: observedEventSequence,
    evidence_kind: input.evidenceKind,
    evidence_sha256: input.evidenceSha256,
    evidence_receipt: structuredClone(input.evidenceReceipt),
  };
  return {
    ...base,
    identity_sha256: payloadDigest(base),
    remediation_status: 'unresolved',
    remediation_history: [
      {
        sequence: 1,
        status: 'unresolved',
        head_sha: input.reviewedHead,
        evidence_sha256: input.evidenceSha256,
        evidence: structuredClone(input.evidenceReceipt),
      },
    ],
  };
};

export const appendReviewBlockers = (
  state,
  reviews,
  reviewBatch,
  observedEventSequence,
) => {
  for (const review of reviews) {
    for (const blocker of review.blockers) {
      const source = reviewBatch.blocker_sources[blocker.signature];
      const receipt = reviewBatch.reviewer_receipts[review.reviewer];
      state.blocker_ledger.push(
        makeEntry(state, {
          blocker,
          reviewedHead: state.head_sha,
          axis: review.reviewer,
          receipt,
          source,
          evidenceKind: 'review-final-response',
          evidenceSha256: receipt.output_sha256,
          evidenceReceipt: receipt.final_response,
          observedEventSequence,
        }),
      );
    }
  }
};

export const appendObservedBlocker = (
  state,
  blocker,
  observationReceipt,
  evidenceKind,
  blockingReason,
  observedEventSequence,
) => {
  const receipt =
    state.conflict_resolution === null
      ? state.local_review.review_batch.reviewer_receipts.verification
      : compositeVerificationReceipt(state);
  const rowId = state.review_preflight.acceptance_row_ids[0];
  const row = state.review_preflight.rows.find((candidate) => candidate.id === rowId);
  state.blocker_ledger.push(
    makeEntry(state, {
      blocker,
      reviewedHead: state.head_sha,
      axis: 'verification',
      receipt,
      source: {
        violated_invariant: rowId,
        contract_source: row.source,
        reproduction: observationReceipt.evidence,
        why_blocking: blockingReason,
      },
      evidenceKind,
      evidenceSha256: payloadDigest(observationReceipt),
      evidenceReceipt: observationReceipt,
      observedEventSequence,
    }),
  );
};

export const remediateCurrentBlockers = (state, blockers, headSha, evidence) => {
  for (const blocker of blockers) {
    const matches = state.blocker_ledger.filter(
      (entry) =>
        entry.remediation_status === 'unresolved' &&
        payloadDigest(entry.blocker) === payloadDigest(blocker),
    );
    if (matches.length !== 1) {
      throw new TypeError('blocker ledger reconciliation is missing or ambiguous.');
    }
    const entry = matches[0];
    entry.remediation_history.push({
      sequence: entry.remediation_history.length + 1,
      status: 'remediated',
      head_sha: headSha,
      evidence_sha256: payloadDigest(evidence),
      evidence: structuredClone(evidence),
    });
    entry.remediation_status = 'remediated';
  }
};

export const unresolvedBlockerLedger = (ledger) =>
  ledger.filter((entry) => entry.remediation_status === 'unresolved');

export const assertBlockerLedger = (state, { verifyTasks = false } = {}) => {
  if (!Array.isArray(state.blocker_ledger)) {
    throw new TypeError('blocker ledger must be an array.');
  }
  const identities = new Set();
  let priorGeneration = 0;
  state.blocker_ledger.forEach((candidate, index) => {
    const entry = requireRecord(candidate, `blocker ledger entry ${String(index + 1)}`);
    const blocker = requireRecord(entry.blocker, 'blocker ledger blocker');
    const receipt = requireRecord(entry.reviewer_receipt, 'blocker ledger reviewer receipt');
    const evidenceReceipt = requireRecord(entry.evidence_receipt, 'blocker ledger evidence receipt');
    const row = state.review_preflight?.rows?.find(
      (candidateRow) => candidateRow.id === entry.preflight_row_id,
    );
    if (
      entry.version !== 1 ||
      entry.sequence !== index + 1 ||
      !Number.isSafeInteger(entry.observed_event_sequence) ||
      entry.observed_event_sequence < 1 ||
      !Number.isSafeInteger(entry.implementer_generation) ||
      entry.implementer_generation < 1 ||
      entry.implementer_generation < priorGeneration ||
      !axes.has(entry.reviewer_axis) ||
      entry.reviewer_axis !== blocker.reviewer ||
      entry.reviewed_head_sha !== receipt.head_sha ||
      entry.preflight_sha256 !== state.review_preflight?.sha256 ||
      row === undefined ||
      entry.approved_contract_source !== row.source ||
      entry.approved_contract_revision !==
        state.review_preflight.approved_sources.find(
          (source) => source.source === row.source,
        )?.revision ||
      typeof entry.reproduction !== 'string' ||
      entry.reproduction.length === 0 ||
      !reasons.has(entry.blocking_reason) ||
      !sha256.test(entry.evidence_sha256 ?? '') ||
      payloadDigest(evidenceReceipt) !== entry.evidence_sha256 ||
      ![
        'review-final-response',
        'verified-pr-conflict-receipt',
        'verified-ci-receipt',
      ].includes(entry.evidence_kind) ||
      entry.identity_sha256 !== payloadDigest(immutableEntry(entry)) ||
      identities.has(entry.identity_sha256)
    ) {
      throw new TypeError('blocker ledger canonical identity, order, or source binding is invalid.');
    }
    const composite =
      receipt.mutation_sentinel === CONFLICT_REVIEW_SENTINEL;
    const compositeSource = state.conflict_resolution?.axes?.find(
      (axis) => axis.axis === 'verification',
    )?.receipt;
    const compositeGate = state.conflict_resolution?.gate_receipt;
    if (
      receipt.axis !== entry.reviewer_axis ||
      receipt.lane_id !== state.lane_id ||
      receipt.issue_number !== state.issue_number ||
      receipt.worktree !== state.worktree ||
      !coordinatorSessionIds(state).includes(receipt.parent_session_id) ||
      payloadDigest(receipt.final_response) !== receipt.output_sha256 ||
      (composite &&
        (entry.evidence_kind !== 'verified-ci-receipt' ||
          receipt.head_sha !== state.conflict_resolution?.resolved_head ||
          receipt.final_response.head_sha !==
            state.conflict_resolution?.resolved_head ||
          receipt.final_response.source_receipt_sha256 !==
            payloadDigest(compositeSource) ||
          receipt.final_response.conflict_gate_receipt_sha256 !==
            payloadDigest(compositeGate) ||
          receipt.record_sha256 !==
            payloadDigest({ gate: compositeGate, source: compositeSource }))) ||
      (!composite && receipt.mutation_sentinel !== REVIEW_SENTINEL) ||
      (entry.evidence_kind === 'review-final-response' &&
        (entry.evidence_sha256 !== receipt.output_sha256 ||
          payloadDigest(evidenceReceipt) !== payloadDigest(receipt.final_response) ||
          !receipt.final_response.blockers.some(
            (candidateBlocker) => payloadDigest(candidateBlocker) === payloadDigest(blocker),
          ) ||
          payloadDigest(receipt.final_response.blocker_sources?.[blocker.signature]) !==
            payloadDigest({
              contract_source: entry.approved_contract_source,
              violated_invariant: entry.preflight_row_id,
              reproduction: entry.reproduction,
              why_blocking: entry.blocking_reason,
            }))) ||
      (entry.evidence_kind === 'verified-pr-conflict-receipt' &&
        (evidenceReceipt.kind !== 'pr-conflict' ||
          evidenceReceipt.head_sha !== entry.reviewed_head_sha ||
          evidenceReceipt.evidence !== blocker.evidence)) ||
      (entry.evidence_kind === 'verified-ci-receipt' &&
        (evidenceReceipt.kind !== 'ci' ||
          evidenceReceipt.head_sha !== entry.reviewed_head_sha ||
          evidenceReceipt.evidence !== blocker.evidence))
    ) {
      throw new TypeError('blocker ledger reviewer task/output evidence is invalid.');
    }
    if (!Array.isArray(entry.remediation_history) || entry.remediation_history.length === 0) {
      throw new TypeError('blocker ledger remediation history is required.');
    }
    entry.remediation_history.forEach((event, eventIndex) => {
      if (
        event.sequence !== eventIndex + 1 ||
        event.status !== (eventIndex === 0 ? 'unresolved' : 'remediated') ||
        !sha256.test(event.evidence_sha256 ?? '') ||
        payloadDigest(event.evidence) !== event.evidence_sha256 ||
        (eventIndex === 0 && event.evidence_sha256 !== entry.evidence_sha256) ||
        !/^[a-f0-9]{40}$/u.test(event.head_sha ?? '')
      ) {
        throw new TypeError('blocker ledger remediation history is out of order or invalid.');
      }
    });
    const terminalStatus = entry.remediation_history.at(-1).status;
    if (entry.remediation_status !== terminalStatus) {
      throw new TypeError('blocker ledger remediation status does not match its history.');
    }
    if (verifyTasks && !composite) {
      const verified = verifyReviewerTask({
        ...reviewerProvenance(
          state,
          receipt.task_id,
          receipt.head_sha,
          entry.reviewer_axis,
        ),
        dag_run_id: receipt.dag_run_id,
        dag_key: receipt.dag_key,
        node_id: receipt.dag_node_id,
        dag_owner_fingerprint: receipt.dag_owner_fingerprint,
        ...(entry.reviewer_axis === 'verification'
          ? {
              canonical_verification_receipt_id:
                receipt.canonical_verification?.receipt_id,
            }
          : {}),
      });
      if (payloadDigest(verified) !== payloadDigest(receipt)) {
        throw new TypeError('blocker ledger reviewer receipt does not match its canonical task.');
      }
    }
    identities.add(entry.identity_sha256);
    priorGeneration = entry.implementer_generation;
  });
  const unresolved = unresolvedBlockerLedger(state.blocker_ledger).map((entry) => entry.blocker);
  if (
    state.status !== 'blocked-maintainer-decision' &&
    state.status !== 'blocked-child-contract-error' &&
    (unresolved.length !== state.blockers.length ||
    unresolved.some(
      (blocker, index) => payloadDigest(blocker) !== payloadDigest(state.blockers[index]),
    ))
  ) {
    throw new TypeError('current blockers must equal the unresolved blocker ledger subset.');
  }
  return state.blocker_ledger;
};
