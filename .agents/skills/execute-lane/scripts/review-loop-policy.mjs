import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  assertContract,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import { REVIEW_SENTINEL, verifyReviewerTask } from './reviewer-runtime.mjs';

const reviewers = ['contract', 'code', 'verification'];
const coverageSignals = new Set(['PASS', 'BLOCK']);
const blockingReasons = new Set([
  'correctness',
  'security',
  'compatibility',
  'required-verification',
]);
const taskIdPattern = /^st_[A-Za-z0-9_-]+$/u;

const requireRecord = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const requireString = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

const requireUniqueStrings = (value, name) => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(`${name} must contain unique non-empty strings.`);
  }
  return [...value];
};

const canonicalPreflightValue = (input) => {
  const value = requireRecord(input, 'review preflight');
  const rows = value.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('review preflight rows must be non-empty.');
  }
  const canonicalRows = rows.map((candidate, index) => {
    const row = requireRecord(candidate, `review preflight rows[${String(index)}]`);
    const sourceBindings = row.source_bindings;
    if (!Array.isArray(sourceBindings) || sourceBindings.length === 0) {
      throw new TypeError(`review preflight rows[${String(index)}].source_bindings must be non-empty.`);
    }
    const canonicalBindings = sourceBindings.map((candidate, bindingIndex) => {
      const binding = requireRecord(
        candidate,
        `review preflight rows[${String(index)}].source_bindings[${String(bindingIndex)}]`,
      );
      return {
        source: requireString(binding.source, 'review preflight row source binding source'),
        revision: requireString(binding.revision, 'review preflight row source binding revision'),
        content_sha256: requireString(
          binding.content_sha256,
          'review preflight row source binding content_sha256',
        ),
      };
    });
    if (new Set(canonicalBindings.map(({ source }) => source)).size !== canonicalBindings.length) {
      throw new TypeError('review preflight row source bindings must be unique.');
    }
    const source = requireString(row.source, `review preflight rows[${String(index)}].source`);
    if (!canonicalBindings.some((binding) => binding.source === source)) {
      throw new TypeError('review preflight row primary source must be revision-bound.');
    }
    const acceptanceText = requireString(
      row.acceptance_text,
      `review preflight rows[${String(index)}].acceptance_text`,
    );
    const acceptanceSha256 = requireString(
      row.acceptance_sha256,
      `review preflight rows[${String(index)}].acceptance_sha256`,
    );
    if (acceptanceSha256 !== payloadDigest({ content: acceptanceText })) {
      throw new TypeError(`review preflight rows[${String(index)}] acceptance digest must match its text.`);
    }
    return {
      id: requireString(row.id, `review preflight rows[${String(index)}].id`),
      acceptance_text: acceptanceText,
      acceptance_sha256: acceptanceSha256,
      source,
      source_bindings: canonicalBindings,
      invariant: requireString(
        row.invariant,
        `review preflight rows[${String(index)}].invariant`,
      ),
      surfaces: requireUniqueStrings(
        row.surfaces,
        `review preflight rows[${String(index)}].surfaces`,
      ),
      positive_cases: requireUniqueStrings(
        row.positive_cases,
        `review preflight rows[${String(index)}].positive_cases`,
      ),
      negative_cases: requireUniqueStrings(
        row.negative_cases,
        `review preflight rows[${String(index)}].negative_cases`,
      ),
      boundary_cases: requireUniqueStrings(
        row.boundary_cases,
        `review preflight rows[${String(index)}].boundary_cases`,
      ),
    };
  });
  if (new Set(canonicalRows.map((row) => row.id)).size !== canonicalRows.length) {
    throw new TypeError('review preflight row IDs must be unique.');
  }
  const nonfunctional = requireRecord(
    value.nonfunctional,
    'review preflight nonfunctional',
  );
  const approvedSources = value.approved_sources;
  if (!Array.isArray(approvedSources) || approvedSources.length === 0) {
    throw new TypeError('review preflight approved_sources must be non-empty.');
  }
  const canonicalSources = approvedSources.map((candidate, index) => {
    const source = requireRecord(
      candidate,
      `review preflight approved_sources[${String(index)}]`,
    );
    return {
      source: requireString(
        source.source,
        `review preflight approved_sources[${String(index)}].source`,
      ),
      revision: requireString(
        source.revision,
        `review preflight approved_sources[${String(index)}].revision`,
      ),
      content_sha256: requireString(
        source.content_sha256,
        `review preflight approved_sources[${String(index)}].content_sha256`,
      ),
    };
  });
  if (
    new Set(canonicalSources.map((source) => source.source)).size !==
    canonicalSources.length
  ) {
    throw new TypeError('review preflight approved sources must be unique.');
  }
  if (
    canonicalRows.some((row) =>
      row.source_bindings.some((binding) =>
        !canonicalSources.some(
          (source) =>
            source.source === binding.source &&
            source.revision === binding.revision &&
            source.content_sha256 === binding.content_sha256,
        ),
      ),
    )
  ) {
    throw new TypeError('review preflight rows must use exact revision-bound approved sources.');
  }
  const coveredSources = new Set(
    canonicalRows.flatMap((row) => row.source_bindings.map(({ source }) => source)),
  );
  if (canonicalSources.some(({ source }) => !coveredSources.has(source))) {
    throw new TypeError('every approved source must be covered by at least one acceptance row.');
  }
  const acceptanceRowIds = requireUniqueStrings(
    value.acceptance_row_ids,
    'review preflight acceptance_row_ids',
  );
  const rowIds = canonicalRows.map((row) => row.id);
  if (
    acceptanceRowIds.length !== rowIds.length ||
    acceptanceRowIds.some((rowId) => !rowIds.includes(rowId))
  ) {
    throw new TypeError('review preflight acceptance rows must be complete.');
  }
  return {
    version: 1,
    lane_id: requireString(value.lane_id, 'review preflight lane_id'),
    issue_number: value.issue_number,
    issue_contract_revision: requireString(
      value.issue_contract_revision,
      'review preflight issue_contract_revision',
    ),
    issue_contract_sha256: requireString(
      value.issue_contract_sha256,
      'review preflight issue_contract_sha256',
    ),
    lane_plan_approval_sha256: requireString(
      value.lane_plan_approval_sha256,
      'review preflight lane_plan_approval_sha256',
    ),
    head_sha: value.head_sha,
    generated_at: value.generated_at,
    approved_sources: canonicalSources,
    acceptance_row_ids: acceptanceRowIds,
    rows: canonicalRows,
    nonfunctional: {
      complexity: requireString(
        nonfunctional.complexity,
        'review preflight nonfunctional.complexity',
      ),
      memory: requireString(
        nonfunctional.memory,
        'review preflight nonfunctional.memory',
      ),
      atomicity: requireString(
        nonfunctional.atomicity,
        'review preflight nonfunctional.atomicity',
      ),
      mutation_boundary: requireString(
        nonfunctional.mutation_boundary,
        'review preflight nonfunctional.mutation_boundary',
      ),
    },
  };
};

export const createReviewPreflight = (input) => {
  const canonical = canonicalPreflightValue(input);
  const preflight = {
    ...canonical,
    sha256: payloadDigest(canonical),
  };
  assertContract('review-preflight', preflight);
  return preflight;
};

export const assertReviewPreflight = (value) => {
  assertContract('review-preflight', value);
  const canonical = canonicalPreflightValue(value);
  if (value.sha256 !== payloadDigest(canonical)) {
    throw new TypeError('review preflight sha256 must match its canonical content.');
  }
  return value;
};

const requireCoverage = (coverage, rowIds, reviewer) => {
  const value = requireRecord(coverage, `review batch coverage.${reviewer}`);
  if (
    Object.keys(value).length !== rowIds.length ||
    rowIds.some(
      (rowId) =>
        !Object.hasOwn(value, rowId) || !coverageSignals.has(value[rowId]),
    )
  ) {
    throw new TypeError(
      `review batch coverage.${reviewer} must close every preflight row.`,
    );
  }
  return Object.fromEntries(rowIds.map((rowId) => [rowId, value[rowId]]));
};

const requireBlockerSources = (sources, reviews, rows, coverage) => {
  const rowIds = rows.map((row) => row.id);
  const value = requireRecord(sources, 'review batch blocker_sources');
  const blockers = reviews.flatMap((review) => review.blockers);
  const signatures = blockers.map((blocker) => blocker.signature);
  if (
    Object.keys(value).length !== signatures.length ||
    new Set(signatures).size !== signatures.length
  ) {
    throw new TypeError(
      'review batch blocker source count must match unique blockers.',
    );
  }
  return Object.fromEntries(
    signatures.map((signature) => {
      const source = requireRecord(
        value[signature],
        `review batch blocker source ${signature}`,
      );
      if (!rowIds.includes(source.violated_invariant)) {
        throw new TypeError(
          `review batch blocker source ${signature} must bind a preflight row.`,
        );
      }
      const blocker = blockers.find(
        (candidate) => candidate.signature === signature,
      );
      const row = rows.find((candidate) => candidate.id === source.violated_invariant);
      if (source.contract_source !== row.source) {
        throw new TypeError(
          `review batch blocker source ${signature} must bind its selected preflight source.`,
        );
      }
      if (coverage[blocker.reviewer][source.violated_invariant] !== 'BLOCK') {
        throw new TypeError(
          `review batch blocker source ${signature} must bind blocked coverage.`,
        );
      }
      if (!blockingReasons.has(source.why_blocking)) {
        throw new TypeError(
          `review batch blocker source ${signature} has an invalid blocking reason.`,
        );
      }
      return [
        signature,
        {
          contract_source: requireString(
            source.contract_source,
            `review batch blocker source ${signature}.contract_source`,
          ),
          violated_invariant: source.violated_invariant,
          reproduction: requireString(
            source.reproduction,
            `review batch blocker source ${signature}.reproduction`,
          ),
          why_blocking: source.why_blocking,
        },
      ];
    }),
  );
};

export const assertReviewBatch = ({
  head_sha: headSha,
  preflight,
  reviews,
  review_batch: reviewBatch,
  provenance = null,
}) => {
  const acceptedPreflight = assertReviewPreflight(preflight);
  const value = requireRecord(reviewBatch, 'review batch');
  if (value.preflight_sha256 !== acceptedPreflight.sha256) {
    throw new TypeError('review batch must bind the accepted preflight.');
  }
  if (!Array.isArray(reviews) || reviews.length !== reviewers.length) {
    throw new TypeError('review batch requires one complete reviewer triad.');
  }
  const taskIds = requireRecord(value.task_ids, 'review batch task_ids');
  const coverage = requireRecord(value.coverage, 'review batch coverage');
  const rowIds = acceptedPreflight.acceptance_row_ids;
  const canonicalTaskIds = {};
  const canonicalCoverage = {};
  const receipts = requireRecord(value.reviewer_receipts, 'review batch reviewer_receipts');
  const canonicalReceipts = {};
  for (const reviewer of reviewers) {
    const review = reviews.find((candidate) => candidate.reviewer === reviewer);
    if (
      review === undefined ||
      review.reviewed_head_sha !== headSha ||
      !taskIdPattern.test(taskIds[reviewer])
    ) {
      throw new TypeError(
        `review batch ${reviewer} result and task must bind the same head.`,
      );
    }
    canonicalTaskIds[reviewer] = taskIds[reviewer];
    const receipt = requireRecord(receipts[reviewer], `review batch ${reviewer} receipt`);
    if (
      receipt.task_id !== taskIds[reviewer] ||
      receipt.axis !== reviewer ||
      receipt.head_sha !== headSha ||
      receipt.mutation_sentinel !== REVIEW_SENTINEL ||
      typeof receipt.record_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(receipt.record_sha256) ||
      !/^[a-f0-9]{64}$/u.test(receipt.session_sha256 ?? '') ||
      payloadDigest(receipt.tool_events) !== receipt.tool_events_sha256 ||
      (reviewer === 'verification'
        ? receipt.canonical_verification?.session_sha256 !== receipt.session_sha256 ||
          JSON.stringify(receipt.canonical_verification?.command) !== JSON.stringify(['pnpm', 'verify']) ||
          receipt.canonical_verification?.status !== 0 ||
          receipt.canonical_verification?.result !== 'pass'
        : receipt.canonical_verification !== null)
    ) {
      throw new TypeError(`review batch ${reviewer} provenance receipt is invalid.`);
    }
    if (
      receipt.output_sha256 === undefined ||
      payloadDigest(receipt.final_response) !== receipt.output_sha256 ||
      receipt.final_response.axis !== reviewer ||
      receipt.final_response.head_sha !== headSha ||
      receipt.final_response.verdict_signal !== review.verdict_signal ||
      JSON.stringify(receipt.final_response.coverage) !== JSON.stringify(coverage[reviewer]) ||
      JSON.stringify(receipt.final_response.blockers) !== JSON.stringify(review.blockers) ||
      JSON.stringify(receipt.final_response.blocker_sources) !==
        JSON.stringify(Object.fromEntries(review.blockers.map((blocker) => [
          blocker.signature,
          value.blocker_sources[blocker.signature],
        ])))
    ) {
      throw new TypeError(`review batch ${reviewer} final response does not match persisted review evidence.`);
    }
    canonicalReceipts[reviewer] = structuredClone(receipt);
    if (
      Object.values(canonicalTaskIds).filter(
        (taskId) => taskId === taskIds[reviewer],
      ).length > 1
    ) {
      throw new TypeError('review batch reviewer task IDs must be distinct.');
    }
    canonicalCoverage[reviewer] = requireCoverage(
      coverage[reviewer],
      rowIds,
      reviewer,
    );
    const hasBlockedCoverage = Object.values(
      canonicalCoverage[reviewer],
    ).includes('BLOCK');
    if (
      (review.verdict_signal === 'BLOCK') !== hasBlockedCoverage
    ) {
      throw new TypeError(
        `review batch ${reviewer} verdict must match its row coverage.`,
      );
    }
  }
  if (provenance !== null) {
    for (const reviewer of reviewers) {
      const verified = verifyReviewerTask({
        ...provenance,
        task_id: canonicalTaskIds[reviewer],
        head_sha: headSha,
        preflight_sha256: acceptedPreflight.sha256,
        axis: reviewer,
      });
      if (payloadDigest(verified) !== payloadDigest(canonicalReceipts[reviewer])) {
        throw new TypeError(`review batch ${reviewer} provenance receipt does not match its canonical task.`);
      }
    }
  }
  return {
    preflight_sha256: acceptedPreflight.sha256,
    task_ids: canonicalTaskIds,
    reviewer_receipts: canonicalReceipts,
    coverage: canonicalCoverage,
    blocker_sources: requireBlockerSources(
      value.blocker_sources,
      reviews,
      acceptedPreflight.rows,
      canonicalCoverage,
    ),
  };
};

export const requireFreshImplementerEvidence = (evidence) => {
  const value = requireRecord(evidence, 'fresh implementer evidence');
  if (
    !taskIdPattern.test(value.task_id) ||
    Object.keys(value).length !== 1
  ) {
    throw new TypeError(
      'fresh implementer evidence must contain only the canonical task ID.',
    );
  }
  return { task_id: value.task_id };
};

export const requireFreshImplementer = ({
  blocked_heads_since_refresh: blockedHeads,
  implementer_generation: currentGeneration,
  fresh_implementer: freshImplementer,
  reported_generation: reportedGeneration,
  fresh_implementer_evidence: freshEvidence,
}) => {
  if (
    !Number.isSafeInteger(blockedHeads) ||
    blockedHeads < 0 ||
    !Number.isSafeInteger(currentGeneration) ||
    currentGeneration < 1
  ) {
    throw new TypeError('implementer refresh telemetry must use safe integers.');
  }
  if (blockedHeads < 2) {
    if (freshImplementer !== false || reportedGeneration !== currentGeneration) {
      throw new TypeError(
        'continued implementer must retain its current generation.',
      );
    }
    return currentGeneration;
  }
  if (
    freshImplementer !== true ||
    reportedGeneration !== currentGeneration + 1
  ) {
    throw new TypeError(
      'two blocked heads require a fresh implementer generation.',
    );
  }
  requireFreshImplementerEvidence(freshEvidence);
  return reportedGeneration;
};

const canonicalVerificationDirectory = (path, create = false) => {
  if (typeof path !== 'string' || path !== resolve(path)) {
    throw new TypeError('canonical verification lease path must be absolute and canonical.');
  }
  const requested = path;
  if (create) {
    mkdirSync(requested, { recursive: true });
  }
  const stat = lstatSync(requested);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(requested) !== requested
  ) {
    throw new TypeError('canonical verification lease path must be a real canonical directory.');
  }
  return requested;
};

const canonicalVerificationOwner = (lockPath, canonicalWorktree) => {
  const stat = lstatSync(lockPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError('canonical verification lease must be a real directory.');
  }
  const ownerPath = resolve(lockPath, 'owner.json');
  const ownerStat = lstatSync(ownerPath);
  if (ownerStat.isSymbolicLink() || !ownerStat.isFile()) {
    throw new TypeError('canonical verification lease owner metadata is malformed.');
  }
  let owner;
  try {
    owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  } catch {
    throw new TypeError('canonical verification lease owner metadata is malformed.');
  }
  if (
    owner?.version !== 3 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.token !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(owner.token) ||
    typeof owner.process_start !== 'string' ||
    owner.process_start.length === 0 ||
    owner.worktree !== canonicalWorktree ||
    typeof owner.lane_id !== 'string' ||
    !Number.isSafeInteger(owner.issue_number) ||
    owner.issue_number <= 0
  ) {
    throw new TypeError('canonical verification lease owner metadata is invalid.');
  }
  return owner;
};

const defaultProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const defaultProcessIdentity = (pid) => {
  if (!defaultProcessAlive(pid)) return null;
  try {
    const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    }).trim();
    return start.length === 0 ? null : start;
  } catch {
    return null;
  }
};

// Candidates are complete before their atomic publish. A dead owner is atomically
// moved to one deterministic token tombstone, which is retained permanently:
// exactly one recovery contender can retire it, and delayed recovery or release
// attempts cannot rename a replacement owner over the nonempty tombstone. A
// crash before publish leaves only an inert candidate; a crash after publish is
// recovered by retiring that owner's token, so neither state wedges the key.
const retireCanonicalVerificationOwner = (lease, token) => {
  if (!existsSync(lease.lock_path)) {
    return false;
  }
  let owner;
  try {
    owner = canonicalVerificationOwner(
      lease.lock_path,
      lease.canonical_worktree,
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (owner.token !== token) {
    return false;
  }
  const retiredPath = resolve(lease.directory, `retired-${token}`);
  try {
    renameSync(lease.lock_path, retiredPath);
    return true;
  } catch (error) {
    if (
      error?.code === 'ENOENT' ||
      error?.code === 'EEXIST' ||
      error?.code === 'ENOTEMPTY'
    ) {
      return false;
    }
    throw error;
  }
};

export const releaseCanonicalVerificationLease = (lease) =>
  retireCanonicalVerificationOwner(lease, lease.token);

export const acquireCanonicalVerificationLease = (
  runtimeRoot,
  laneId,
  issueNumber,
  worktree,
  options = {},
) => {
  if (
    !/^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(laneId) ||
    !Number.isSafeInteger(issueNumber) ||
    issueNumber <= 0 ||
    typeof worktree !== 'string'
  ) {
    throw new TypeError('canonical verification lease identity is invalid.');
  }
  const processIdentity = options.process_identity ?? defaultProcessIdentity;
  const processAlive = options.process_alive ?? defaultProcessAlive;
  const pid = options.pid ?? process.pid;
  if (
    typeof processIdentity !== 'function' ||
    typeof processAlive !== 'function' ||
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    throw new TypeError('canonical verification lease process identity is invalid.');
  }
  const processStart = processIdentity(pid);
  if (typeof processStart !== 'string' || processStart.length === 0) {
    throw new TypeError('canonical verification lease cannot identify its owner process.');
  }
  const canonicalRuntimeRoot = canonicalVerificationDirectory(runtimeRoot);
  const canonicalWorktree = canonicalVerificationDirectory(worktree);
  const namespace = canonicalVerificationDirectory(
    resolve(canonicalRuntimeRoot, 'canonical-verification'),
    true,
  );
  const key = createHash('sha256').update(canonicalWorktree).digest('hex');
  const directory = canonicalVerificationDirectory(resolve(namespace, key), true);
  const lockPath = resolve(directory, 'owner.lock');
  const token = randomUUID();
  const candidatePath = resolve(directory, `candidate-${token}`);
  mkdirSync(candidatePath);
  writeFileSync(
    resolve(candidatePath, 'owner.json'),
    `${JSON.stringify({
      version: 3,
      token,
      pid,
      process_start: processStart,
      lane_id: laneId,
      issue_number: issueNumber,
      worktree: canonicalWorktree,
    })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  const lease = {
    token,
    lock_path: lockPath,
    directory,
    canonical_worktree: canonicalWorktree,
  };
  try {
    for (;;) {
      try {
        renameSync(candidatePath, lockPath);
        return lease;
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') {
          throw error;
        }
      }
      let owner;
      try {
        owner = canonicalVerificationOwner(lockPath, canonicalWorktree);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      const observedIdentity = processIdentity(owner.pid);
      if (
        observedIdentity === owner.process_start ||
        (observedIdentity === null && processAlive(owner.pid))
      ) {
        throw new TypeError('canonical verification is already running.');
      }
      // Reclaim only a proven-dead PID or a different non-null fingerprint
      // proving PID reuse. An inconclusive live identity always fails closed.
      retireCanonicalVerificationOwner(lease, owner.token);
    }
  } finally {
    if (existsSync(candidatePath)) {
      rmSync(candidatePath, { recursive: true });
    }
  }
};

export const withCanonicalVerificationLease = (
  runtimeRoot,
  laneId,
  issueNumber,
  worktree,
  operation,
) => {
  if (typeof operation !== 'function') {
    throw new TypeError('canonical verification lease identity is invalid.');
  }
  const lease = acquireCanonicalVerificationLease(
    runtimeRoot,
    laneId,
    issueNumber,
    worktree,
  );
  try {
    return operation();
  } finally {
    releaseCanonicalVerificationLease(lease);
  }
};
