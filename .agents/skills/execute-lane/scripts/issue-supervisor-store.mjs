import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import {
  createIssueSupervisor,
  transitionIssueSupervisor,
} from './issue-supervisor.mjs';
import { assertIssueSupervisorState } from './issue-supervisor-contracts.mjs';
import {
  assertRealFile,
  atomicWrite,
  issueDirectory,
  withIssueLease,
} from './issue-supervisor-files.mjs';
import {
  assertSupervisorHistory,
  eventFor,
  persistedEventHash,
} from './issue-supervisor-history.mjs';
import { assertPersistedReceipt } from './issue-supervisor-receipts.mjs';
import { verifyImplementerRuntime } from './implementer-runtime.mjs';
import { verifyReviewerTask } from './reviewer-runtime.mjs';
import { canonicalLaneRuntimeRoot } from './lane-runtime-paths.mjs';
import { assertBlockerLedger } from './blocker-ledger.mjs';
import {
  assertCanonicalPreflightArtifact,
  canonicalPreflightArtifactPath,
} from './dispatch-authority.mjs';
import {
  assertCanonicalPreflightAuthority,
  resolveCanonicalPreflightAuthority,
} from './preflight-authority.mjs';
import {
  assertCanonicalAdditionalSource,
  assertCanonicalCleanupGitState,
  assertCanonicalGitState,
  computeConflictGitEvidence,
} from './trusted-evidence.mjs';

const filenames = {
  snapshot: 'snapshot.json',
  events: 'events.jsonl',
  receipts: 'receipts.json',
  transaction: 'transaction.json',
};

const assertBundle = (bundle) => {
  assertIssueSupervisorState(bundle.snapshot);
  assertSupervisorHistory(bundle.snapshot, bundle.events);
  if (!Array.isArray(bundle.receipts)) {
    throw new TypeError('issue supervisor receipts must be an array.');
  }
  bundle.receipts.forEach((receipt) =>
    assertPersistedReceipt(bundle.snapshot, receipt),
  );
  const stateReceipts = [
    bundle.snapshot.pr?.receipt,
    bundle.snapshot.ci,
    bundle.snapshot.conflict_receipt,
    bundle.snapshot.conflict_resolution?.conflict_receipt,
    bundle.snapshot.merge?.receipt,
    bundle.snapshot.cleanup?.receipt,
  ].filter((receipt) => receipt !== undefined && receipt !== null);
  for (const receipt of stateReceipts) {
    const digest = payloadDigest(receipt);
    if (
      bundle.receipts.filter(
        (persistedReceipt) => payloadDigest(persistedReceipt) === digest,
      ).length !== 1
    ) {
      throw new TypeError(
        'issue supervisor state-bound receipt must exist exactly once.',
      );
    }
  }
};

export const assertIssueSupervisorBundle = assertBundle;

const applyTransaction = (directory, transaction) => {
  assertBundle(transaction);
  atomicWrite(
    resolve(directory, filenames.snapshot),
    `${JSON.stringify(transaction.snapshot, null, 2)}\n`,
  );
  atomicWrite(
    resolve(directory, filenames.events),
    `${transaction.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  atomicWrite(
    resolve(directory, filenames.receipts),
    `${JSON.stringify(transaction.receipts, null, 2)}\n`,
  );
  const path = resolve(directory, filenames.transaction);
  if (existsSync(path)) {
    unlinkSync(path);
  }
};

const recoverTransaction = (directory) => {
  const path = resolve(directory, filenames.transaction);
  assertRealFile(path);
  if (existsSync(path)) {
    applyTransaction(directory, JSON.parse(readFileSync(path, 'utf8')));
  }
};

const readBundle = (directory, { recover = true } = {}) => {
  const transactionPath = resolve(
    directory,
    filenames.transaction,
  );
  if (recover) {
    recoverTransaction(directory);
  } else if (existsSync(transactionPath)) {
    throw new TypeError(
      'read-only issue supervisor load refuses a pending transaction.',
    );
  }
  const snapshotPath = resolve(directory, filenames.snapshot);
  if (!existsSync(snapshotPath)) {
    return null;
  }
  for (const name of ['snapshot', 'events', 'receipts']) {
    assertRealFile(resolve(directory, filenames[name]));
  }
  const eventText = readFileSync(resolve(directory, filenames.events), 'utf8');
  const bundle = {
    snapshot: JSON.parse(readFileSync(snapshotPath, 'utf8')),
    events: eventText
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    receipts: JSON.parse(
      readFileSync(resolve(directory, filenames.receipts), 'utf8'),
    ),
  };
  assertBundle(bundle);
  return bundle;
};

const persistBundle = (directory, bundle, expectedPreviousHash) => {
  const transactionPath = resolve(directory, filenames.transaction);
  assertRealFile(transactionPath);
  if (existsSync(transactionPath)) {
    throw new TypeError('issue supervisor transaction already exists.');
  }
  if (
    persistedEventHash(directory, filenames.events) !== expectedPreviousHash
  ) {
    throw new TypeError('issue supervisor event CAS conflict.');
  }
  writeFileSync(
    transactionPath,
    `${JSON.stringify({ version: 2, ...bundle }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  applyTransaction(directory, bundle);
};

const requireCanonicalRuntimeRoot = (runtimeRoot, repositoryRoot) => {
  if (typeof runtimeRoot !== 'string' || !existsSync(runtimeRoot)) {
    throw new TypeError('issue supervisor runtime root must be canonical.');
  }
  const stat = lstatSync(runtimeRoot);
  const expected = canonicalLaneRuntimeRoot(repositoryRoot);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    resolve(runtimeRoot) !== expected ||
    realpathSync(runtimeRoot) !== expected
  ) {
    throw new TypeError('issue supervisor runtime root must equal the canonical lane runtime root.');
  }
  return expected;
};

const canonicalStoreIdentity = (runtimeRoot, identity, options) => {
  requireCanonicalRuntimeRoot(runtimeRoot, identity.repository_root);
  const observedSupervisorSessionId =
    options.supervisor_session_id ??
    (options.command_runner === undefined
      ? process.env.PI_SESSION_ID
      : identity.parent_session_id);
  if (
    typeof observedSupervisorSessionId !== 'string' ||
    observedSupervisorSessionId.length === 0
  ) {
    throw new TypeError(
      'issue supervisor session identity must come from the runtime.',
    );
  }
  if (
    identity.parent_session_id !== undefined &&
    identity.parent_session_id !== observedSupervisorSessionId
  ) {
    throw new TypeError(
      'issue supervisor parent session does not match the observed runtime session.',
    );
  }
  const authority = resolveCanonicalPreflightAuthority({
    ...identity,
    command_runner: options.command_runner,
  });
  assertCanonicalGitState({
    ...identity,
    expected_head: identity.starting_head_sha,
    commits: [identity.starting_head_sha],
    command_runner: options.command_runner,
  });
  for (const [key, expected] of [
    ['issue_contract_revision', authority.issue_contract_revision],
    ['issue_contract_sha256', authority.issue_contract_sha256],
    ['lane_plan_approval_sha256', authority.lane_plan_approval_sha256],
    ['authority_scope', authority.authority_scope],
    ['retry_policy', authority.retry_policy],
    ['release_handoff', authority.release_handoff],
  ]) {
    if (
      identity[key] !== undefined &&
      JSON.stringify(identity[key]) !== JSON.stringify(expected)
    ) {
      throw new TypeError(`issue supervisor canonical authority conflict: ${key}.`);
    }
  }
  if (
    identity.preflight_authority !== undefined &&
    payloadDigest(identity.preflight_authority) !== payloadDigest(authority)
  ) {
    throw new TypeError('issue supervisor canonical authority receipt conflict.');
  }
  return {
    ...identity,
    parent_session_id: observedSupervisorSessionId,
    issue_contract_revision: authority.issue_contract_revision,
    issue_contract_sha256: authority.issue_contract_sha256,
    lane_plan_approval_sha256: authority.lane_plan_approval_sha256,
    authority_scope: authority.authority_scope,
    retry_policy: authority.retry_policy,
    release_handoff: authority.release_handoff,
    preflight_authority: authority,
  };
};

const assertCanonicalPreflight = (snapshot, options) => {
  if (snapshot.review_preflight === null) return;
  const preflight = snapshot.review_preflight;
  assertCanonicalPreflightArtifact({
    repository_root: snapshot.repository_root,
    lane_id: snapshot.lane_id,
    issue_number: snapshot.issue_number,
    preflight_path: canonicalPreflightArtifactPath(
      snapshot.repository_root,
      snapshot.lane_id,
      snapshot.issue_number,
    ),
    preflight_sha256: preflight.sha256,
  });
  const authority = snapshot.preflight_authority;
  const rowIds = preflight.rows.map(({ id }) => id);
  if (
    JSON.stringify(preflight.acceptance_row_ids) !== JSON.stringify(authority.canonical_acceptance_ids) ||
    JSON.stringify(rowIds) !== JSON.stringify(authority.canonical_acceptance_ids) ||
    preflight.rows.some((row, index) => {
      const criterion = authority.canonical_acceptance_criteria[index];
      return row.id !== criterion?.id ||
        row.acceptance_text !== criterion.content ||
        row.acceptance_sha256 !== criterion.content_sha256;
    })
  ) {
    throw new TypeError('review preflight acceptance rows must bind the complete canonical acceptance text and digest set.');
  }
  const approvedByName = new Map(preflight.approved_sources.map((source) => [source.source, source]));
  for (const core of authority.canonical_sources) {
    if (payloadDigest(approvedByName.get(core.source)) !== payloadDigest(core)) {
      throw new TypeError('review preflight must bind every canonical core authority source exactly.');
    }
  }
  const coreNames = new Set(authority.canonical_sources.map(({ source }) => source));
  for (const source of preflight.approved_sources) {
    if (!coreNames.has(source.source)) {
      assertCanonicalAdditionalSource(source, snapshot.repository_root, options);
    }
  }
};

const assertCanonicalStore = (
  runtimeRoot,
  snapshot,
  options = {},
  canonicalTransitionHead = snapshot.head_sha,
) => {
  requireCanonicalRuntimeRoot(runtimeRoot, snapshot.repository_root);
  assertCanonicalPreflightAuthority(snapshot, options);
  const cleanupCompleted =
    snapshot.authority_scope.cleanup_command_worktrees === true &&
    (options.cleanup_removed === true ||
      (snapshot.status === 'done' && snapshot.cleanup?.status === 'done'));
  if (cleanupCompleted) {
    assertCanonicalCleanupGitState({
      repository_root: snapshot.repository_root,
      worktree: snapshot.worktree,
      branch: snapshot.branch,
      expected_head: snapshot.head_sha,
      command_runner: options.command_runner,
    });
  } else {
    assertCanonicalGitState({
      repository_root: snapshot.repository_root,
      worktree: snapshot.worktree,
      branch: snapshot.branch,
      expected_head: canonicalTransitionHead,
      commits: [
        snapshot.starting_head_sha,
        ...snapshot.implementer_tasks.flatMap(({ current_head: currentHead, new_head: newHead }) => [currentHead, newHead]),
        ...(snapshot.local_review === null ? [] : [snapshot.local_review.head_sha]),
        ...(snapshot.conflict_resolution === null
          ? []
          : [
              snapshot.conflict_resolution.previously_reviewed_head,
              snapshot.conflict_resolution.upstream_head,
              snapshot.conflict_resolution.resolved_head,
            ]),
      ],
      command_runner: options.command_runner,
      allow_untracked: options.allow_untracked === true,
    });
  }
  assertCanonicalPreflight(snapshot, options);
  if (snapshot.conflict_resolution !== null) {
    const computed = computeConflictGitEvidence({
      repository_root: snapshot.repository_root,
      worktree: cleanupCompleted ? '.' : snapshot.worktree,
      previously_reviewed_head: snapshot.conflict_resolution.previously_reviewed_head,
      upstream_head: snapshot.conflict_resolution.upstream_head,
      resolved_head: snapshot.conflict_resolution.resolved_head,
      command_runner: options.command_runner,
    });
    const { diffs: _diffs, ...machineEvidence } = computed;
    if (
      payloadDigest(computed.digests) !== payloadDigest(snapshot.conflict_resolution.digests) ||
      payloadDigest(machineEvidence) !== payloadDigest(snapshot.conflict_resolution.machine_evidence)
    ) {
      throw new TypeError('conflict resolution claims do not match canonical Git evidence.');
    }
    const minimumAxes = computed.classifier.minimum_affected_axes;
    if (
      snapshot.conflict_resolution.upstream_relevant !== computed.upstream_overlap ||
      (snapshot.conflict_resolution.semantic_impact === 'mechanical' &&
        !computed.mechanical_inheritance_eligible) ||
      (snapshot.conflict_resolution.semantic_impact !== 'mechanical' &&
        minimumAxes.some((axis) => !snapshot.conflict_resolution.affected_axes.includes(axis)))
    ) {
      throw new TypeError('conflict resolution rerun axes omit the canonical Git minimum impact.');
    }
    const evidenceText = Object.values(computed.diffs).join('\n');
    if (
      snapshot.conflict_resolution.conflicting_files.some(
        (file) => !evidenceText.includes(file),
      ) ||
      snapshot.conflict_resolution.conflicting_hunks.some(
        (hunk) => !evidenceText.includes(hunk),
      )
    ) {
      throw new TypeError('conflict files or hunks do not exist in canonical Git diff evidence.');
    }
  }
  assertBlockerLedger(snapshot, { verifyTasks: true });
  if (snapshot.local_review !== null) {
    for (const [axis, receipt] of Object.entries(
      snapshot.local_review.review_batch.reviewer_receipts,
    )) {
      const verified = verifyReviewerTask({
        repository_root: snapshot.repository_root,
        task_id: receipt.task_id,
        parent_session_id: snapshot.parent_session_id,
        lane_id: snapshot.lane_id,
        issue_number: snapshot.issue_number,
        worktree: snapshot.worktree,
        branch: snapshot.branch,
        head_sha: snapshot.local_review.head_sha,
        preflight_sha256: snapshot.review_preflight.sha256,
        axis,
      });
      if (payloadDigest(verified) !== payloadDigest(receipt)) {
        throw new TypeError(
          'persisted local review receipt does not match its canonical task record.',
        );
      }
    }
  }
  for (const receipt of snapshot.implementer_tasks) {
    const output = receipt.final_response;
    const verified = verifyImplementerRuntime({
      repository_root: snapshot.repository_root,
      task_id: receipt.task_id,
      parent_session_id: snapshot.parent_session_id,
      lane_id: snapshot.lane_id,
      issue_number: snapshot.issue_number,
      worktree: snapshot.worktree,
      current_head: receipt.current_head,
      new_head: receipt.new_head,
      generation: receipt.generation,
      result: output.result,
      verification: output.verification,
      addressed_blockers: output.addressed_blockers,
      blocker_ledger: receipt.blocker_ledger,
      unresolved_blockers: receipt.unresolved_blockers,
      blocker_ledger_sha256: receipt.blocker_ledger_sha256,
      preflight_sha256: snapshot.review_preflight.sha256,
    });
    if (payloadDigest(verified) !== payloadDigest(receipt)) {
      throw new TypeError(
        'persisted implementer receipt does not match its canonical task record.',
      );
    }
  }
};

export const initialiseIssueSupervisorStore = (runtimeRoot, identity, options = {}) => {
  const canonicalIdentity = canonicalStoreIdentity(runtimeRoot, identity, options);
  const directory = issueDirectory(
    runtimeRoot,
    canonicalIdentity.lane_id,
    canonicalIdentity.issue_number,
  );
  return withIssueLease(directory, () => {
    const existing = readBundle(directory);
    if (existing !== null) {
      if (existing.snapshot.version !== 2) {
        throw new TypeError(
          'non-v2 issue supervisor stores are not supported.',
        );
      }
      assertCanonicalStore(runtimeRoot, existing.snapshot, options);
      const expected = {
        ...canonicalIdentity,
        release_handoff: canonicalIdentity.release_handoff === true,
      };
      for (const key of [
        'lane_id',
        'issue_number',
        'branch',
        'worktree',
        'starting_head_sha',
        'started_at',
        'repository_root',
        'parent_session_id',
        'authority_scope',
        'retry_policy',
        'review_policy',
        'issue_contract_revision',
        'issue_contract_sha256',
        'lane_plan_approval_sha256',
        'preflight_authority',
        'release_handoff',
      ]) {
        if (
          JSON.stringify(existing.snapshot[key]) !==
          JSON.stringify(expected[key])
        ) {
          throw new TypeError(
            `issue supervisor store identity conflict: ${key}.`,
          );
        }
      }
      return existing;
    }
    const initial = createIssueSupervisor(canonicalIdentity);
    const transition = { kind: 'initialised' };
    const bundle = {
      snapshot: initial,
      events: [eventFor([], transition, initial)],
      receipts: [],
    };
    persistBundle(directory, bundle, null);
    return bundle;
  }, options.lease_options);
};

export const applyIssueSupervisorTransition = (
  runtimeRoot,
  laneId,
  issueNumber,
  transition,
  options = {},
) => {
  const directory = issueDirectory(runtimeRoot, laneId, issueNumber);
  return withIssueLease(directory, () => {
    const current = readBundle(directory);
    if (current === null) {
      throw new TypeError('issue supervisor store must be initialised.');
    }
    const cleanupRemoved =
      transition?.kind === 'cleanup-observed' &&
      transition.receipt?.worktree_removed === true &&
      transition.receipt?.local_branch_deleted === true &&
      transition.receipt?.remote_branch_deleted === true;
    const advancingHead =
      transition?.kind === 'implementation-completed' || transition?.kind === 'fix-completed'
        ? transition.new_head
        : transition?.kind === 'conflict-resolved'
          ? transition.gate?.resolved_head
          : transition?.kind === 'child-contract-error'
            ? transition.observed_head
          : undefined;
    assertCanonicalStore(
      runtimeRoot,
      current.snapshot,
      { ...options, cleanup_removed: cleanupRemoved },
      advancingHead ?? current.snapshot.head_sha,
    );
    const observedEventSequence = current.events.length + 1;
    let canonicalTransition = transition;
    if (transition?.kind === 'conflict-resolved') {
      const machine = computeConflictGitEvidence({
        repository_root: current.snapshot.repository_root,
        worktree: current.snapshot.worktree,
        previously_reviewed_head: transition.gate?.previously_reviewed_head,
        upstream_head: transition.gate?.upstream_head,
        resolved_head: transition.gate?.resolved_head,
        command_runner: options.command_runner,
      });
      const { diffs: _diffs, ...machineEvidence } = machine;
      canonicalTransition = { ...transition, machine_evidence: machineEvidence };
    }
    const snapshot = transitionIssueSupervisor(current.snapshot, canonicalTransition, {
      observedEventSequence,
      now: options.now ?? Date.now(),
    });
    if (snapshot.review_preflight !== null && current.snapshot.review_preflight === null) {
      const preflightPath = canonicalPreflightArtifactPath(
        snapshot.repository_root,
        snapshot.lane_id,
        snapshot.issue_number,
      );
      if (existsSync(preflightPath)) {
        const persisted = JSON.parse(readFileSync(preflightPath, 'utf8'));
        if (payloadDigest(persisted) !== payloadDigest(snapshot.review_preflight)) {
          throw new TypeError('canonical immutable review preflight artifact conflicts with accepted authority.');
        }
      } else {
        writeFileSync(preflightPath, `${JSON.stringify(snapshot.review_preflight, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
      }
    }
    assertCanonicalStore(runtimeRoot, snapshot, options);
    const receipt =
      typeof transition.receipt === 'object' && transition.receipt !== null
        ? transition.receipt
        : null;
    const bundle = {
      snapshot,
      events: [
        ...current.events,
        eventFor(current.events, canonicalTransition, snapshot),
      ],
      receipts:
        receipt === null ? current.receipts : [...current.receipts, receipt],
    };
    persistBundle(
      directory,
      bundle,
      current.events.at(-1)?.event_hash ?? null,
    );
    return bundle;
  }, options.lease_options);
};

export const loadIssueSupervisorStore = (
  runtimeRoot,
  laneId,
  issueNumber,
  options = {},
) => {
  const directory = issueDirectory(runtimeRoot, laneId, issueNumber);
  return withIssueLease(directory, () => {
    const bundle = readBundle(directory);
    if (bundle !== null) {
      assertCanonicalStore(runtimeRoot, bundle.snapshot, options);
    }
    return bundle;
  }, options.lease_options);
};

export const readIssueSupervisorStore = (
  runtimeRoot,
  laneId,
  issueNumber,
  options = {},
) => {
  const directory = issueDirectory(runtimeRoot, laneId, issueNumber);
  const bundle = readBundle(directory, { recover: false });
  if (bundle !== null) {
    assertCanonicalStore(runtimeRoot, bundle.snapshot, options);
  }
  return bundle;
};
