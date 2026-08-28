import assert from 'node:assert/strict';
import { execFileSync, fork, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyIssueSupervisorTransition,
  initialiseIssueSupervisorStore,
  loadIssueSupervisorStore,
} from './issue-supervisor-store.mjs';

import {
  acquireCanonicalVerificationLease,
  assertReviewBatch,
  createReviewPreflight,
  releaseCanonicalVerificationLease,
  requireFreshImplementer,
  withCanonicalVerificationLease,
} from './review-loop-policy.mjs';
import {
  createIssueSupervisor,
  transitionIssueSupervisor,
} from './issue-supervisor.mjs';
import { assertIssueSupervisorState } from './issue-supervisor-contracts.mjs';
import {
  publishCanonicalVerificationReceipt,
  resolveTrustedPnpmStore,
  runCanonicalVerification,
} from './canonical-verification.mjs';
import { completedProgress } from './supervisor-terminal-evidence.mjs';
import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { prepareCanonicalV2Runtime } from './fixtures/v2-canonical-runtime.mjs';
import { computeConflictGitEvidence } from './trusted-evidence.mjs';
import {
  writeActualShapedConflictImplementerTask,
  writeActualShapedImplementerTask,
} from './fixtures/implementer-task.mjs';
import { writeActualShapedReviewerTask } from './fixtures/reviewer-task.mjs';
import { canonicalPreflightArtifactPath } from './dispatch-authority.mjs';
import {
  conflictReviewerPromptSentinel,
  conflictReviewerTaskName,
  reviewerPromptSentinel,
  reviewerTaskName,
} from './reviewer-runtime.mjs';

import {
  applyConflictResolution,
  assertConflictResolutionEvidence,
} from './conflict-resolution-policy.mjs';
import { appendObservedBlocker } from './blocker-ledger.mjs';
import {
  formatSenpiFinalResponse,
  parseSenpiFinalResponse,
} from './senpi-final-response.mjs';

const mutateTaskOutput = (task, sentinel, mutate) => {
  const output = parseSenpiFinalResponse(
    task.final_response,
    sentinel,
    'test task final_response',
  );
  mutate(output);
  task.final_response = formatSenpiFinalResponse(sentinel, output);
  return output;
};

const head = 'a'.repeat(40);
const reviewRepositoryRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'fluo-review-tasks-')),
);
after(() => {
  rmSync(reviewRepositoryRoot, { force: true, recursive: true });
});
const taskIds = {
  contract: 'st_contract',
  code: 'st_code',
  verification: 'st_verification',
};

const preflight = () =>
  createReviewPreflight({
    lane_id: 'lane-a',
    issue_number: 3305,
    issue_contract_revision: 'issue-3305@1',
    issue_contract_sha256: '1'.repeat(64),
    lane_plan_approval_sha256: '2'.repeat(64),
    head_sha: head,
    generated_at: '2026-08-26T00:00:00.000Z',
    approved_sources: [
      { source: 'issue #3305 acceptance criteria', revision: 'issue-3305@1', content_sha256: '3'.repeat(64) },
    ],
    acceptance_row_ids: ['accept-header-presence'],
    rows: [
      {
        id: 'accept-header-presence',
        acceptance_text: 'Present blank Accept is distinct from a missing header.',
        acceptance_sha256: payloadDigest({ content: 'Present blank Accept is distinct from a missing header.' }),
        source: 'issue #3305 acceptance criteria',
        source_bindings: [{ source: 'issue #3305 acceptance criteria', revision: 'issue-3305@1', content_sha256: '3'.repeat(64) }],
        invariant: 'Present blank Accept is distinct from a missing header.',
        surfaces: ['native', 'fallback'],
        positive_cases: ['missing Accept selects the default formatter'],
        negative_cases: ['blank Accept returns 406'],
        boundary_cases: ['mixed blank and valid fields preserve the valid field'],
      },
    ],
    nonfunctional: {
      complexity: 'Parsing is linear in header bytes.',
      memory: 'No unbounded intermediate collections.',
      atomicity: 'Vary is committed with the negotiated response.',
      mutation_boundary: 'Request headers are observed without mutation.',
    },
  });

const reviews = [
  {
    reviewer: 'contract',
    reviewed_head_sha: head,
    verdict_signal: 'PASS',
    blockers: [],
  },
  {
    reviewer: 'code',
    reviewed_head_sha: head,
    verdict_signal: 'BLOCK',
    blockers: [
      {
        reviewer: 'code',
        signature: 'accept:blank-present:must-return-406',
        evidence: 'A blank field currently selects the default formatter.',
        fix_back_eligible: true,
        status: 'unresolved',
      },
    ],
  },
  {
    reviewer: 'verification',
    reviewed_head_sha: head,
    verdict_signal: 'PASS',
    blockers: [],
  },
];

const reviewBatch = (
  reviewPreflight,
  reviewedHead = head,
  codePass = false,
  taskRepositoryRoot = reviewRepositoryRoot,
) => {
  const preflightPath = canonicalPreflightArtifactPath(taskRepositoryRoot, 'lane-a', 3305);
  mkdirSync(resolve(preflightPath, '..'), { recursive: true });
  if (!existsSync(preflightPath)) {
    writeFileSync(preflightPath, `${JSON.stringify(reviewPreflight, null, 2)}\n`, { flag: 'wx' });
  }
  const contractSource = reviewPreflight.rows[0].source;
  const rowIds = reviewPreflight.acceptance_row_ids;
  const coverageFor = (signal) => Object.fromEntries(rowIds.map((rowId) => [rowId, signal]));
  const taskRoot = join(
    taskRepositoryRoot,
    '.omo',
    'senpi-task',
    'tasks',
  );
  mkdirSync(taskRoot, { recursive: true });
  const reviewer_receipts = Object.fromEntries(Object.entries(taskIds).map(([axis, task_id]) => {
    const dagRunId = 'dag_issue-3305';
    const dagKey = 'fluo:lane:lane-a:issue-3305:lifecycle:v3';
    const nodeId = `review-${axis}-${reviewedHead}`;
    const canonicalVerificationReceiptId =
      `st_parent_verify_${reviewedHead.slice(0, 12)}`;
    const ownerFingerprint = payloadDigest(nodeId);
    const output = {
      sentinel: 'fluo:execute-lane:review:final:v1', axis, head_sha: reviewedHead,
      preflight_sha256: reviewPreflight.sha256,
      verdict_signal: axis === 'code' && !codePass ? 'BLOCK' : 'PASS',
      coverage: coverageFor(axis === 'code' && !codePass ? 'BLOCK' : 'PASS'),
      blockers: axis === 'code' && !codePass ? reviews[1].blockers : [],
      blocker_sources: axis === 'code' && !codePass ? { 'accept:blank-present:must-return-406': { contract_source: contractSource, violated_invariant: rowIds[0], reproduction: 'Send Accept with only optional whitespace.', why_blocking: 'correctness' } } : {},
    };
    const task = {
      task_id,
      status: 'completed',
      parent_session_id: 'ses_parent',
      agent_type: `fluo-${axis === 'verification' ? 'verification' : axis}-reviewer`,
      name: nodeId,
      owner: {
        kind: 'dag',
        runId: dagRunId,
        nodeId,
        fingerprint: ownerFingerprint,
      },
      final_response: formatSenpiFinalResponse(
        'fluo:execute-lane:review:final:v1',
        output,
      ),
      spawn_spec: {
        cwd: taskRepositoryRoot,
        prompt:
          `Review without mutation.\n${reviewerPromptSentinel({
            repository_root: taskRepositoryRoot,
            lane_id: 'lane-a',
            issue_number: 3305,
            worktree: '.worktrees/issue-3305-content-negotiation',
            head_sha: reviewedHead,
            preflight_sha256: reviewPreflight.sha256,
            review_axis: axis,
            ...(axis === 'verification'
              ? {
                  canonical_verification_receipt_id:
                    canonicalVerificationReceiptId,
                }
              : {}),
            dag_key: dagKey,
            node_id: nodeId,
          })}`,
      },
    };
    const receipt = writeActualShapedReviewerTask({
      task,
      repository_root: taskRepositoryRoot,
      expected: {
        task_id,
        parent_session_id: 'ses_parent',
        lane_id: 'lane-a',
        issue_number: 3305,
        worktree: '.worktrees/issue-3305-content-negotiation',
        branch: 'issue-3305-content-negotiation',
        head_sha: reviewedHead,
        preflight_sha256: reviewPreflight.sha256,
        axis,
        ...(axis === 'verification'
          ? {
              canonical_verification_receipt_id:
                canonicalVerificationReceiptId,
            }
          : {}),
        dag_run_id: dagRunId,
        dag_key: dagKey,
        node_id: nodeId,
        dag_owner_fingerprint: ownerFingerprint,
      },
    });
    return [axis, receipt];
  }));
  return {
  preflight_sha256: reviewPreflight.sha256,
  task_ids: { ...taskIds },
  reviewer_receipts,
  coverage: {
    contract: coverageFor('PASS'),
    code: coverageFor(codePass ? 'PASS' : 'BLOCK'),
    verification: coverageFor('PASS'),
  },
  blocker_sources: {
    'accept:blank-present:must-return-406': {
      contract_source: contractSource,
      violated_invariant: rowIds[0],
      reproduction: 'Send Accept with only optional whitespace.',
      why_blocking: 'correctness',
    },
  },
};
};

test('review preflight is immutable and content-addressed', () => {
  const value = preflight();
  assert.equal(value.version, 1);
  assert.match(value.sha256, /^[a-f0-9]{64}$/u);
  assert.throws(
    () =>
      createReviewPreflight({
        ...value,
        rows: [{ ...value.rows[0], negative_cases: [] }],
      }),
    /negative_cases/u,
  );
});

test('review batch requires complete triad coverage and blocker sources', () => {
  const value = preflight();
  assert.deepEqual(
    assertReviewBatch({
      head_sha: head,
      preflight: value,
      reviews,
      review_batch: reviewBatch(value),
    }),
    reviewBatch(value),
  );
  const incomplete = reviewBatch(value);
  delete incomplete.coverage.verification['accept-header-presence'];
  assert.throws(
    () =>
      assertReviewBatch({
        head_sha: head,
        preflight: value,
        reviews,
        review_batch: incomplete,
      }),
    /coverage|final response/u,
  );
  const untethered = reviewBatch(value);
  delete untethered.blocker_sources['accept:blank-present:must-return-406'];
  assert.throws(
    () =>
      assertReviewBatch({
        head_sha: head,
        preflight: value,
        reviews,
        review_batch: untethered,
      }),
    /blocker source|final response/u,
  );
  const duplicateTasks = reviewBatch(value);
  duplicateTasks.task_ids.code = duplicateTasks.task_ids.contract;
  assert.throws(
    () =>
      assertReviewBatch({
        head_sha: head,
        preflight: value,
        reviews,
        review_batch: duplicateTasks,
      }),
    /task IDs|provenance/u,
  );
  const inventedSource = reviewBatch(value);
  inventedSource.blocker_sources['accept:blank-present:must-return-406'].contract_source = 'invented source';
  assert.throws(
    () =>
      assertReviewBatch({
        head_sha: head,
        preflight: value,
        reviews,
        review_batch: inventedSource,
      }),
    /selected preflight source|final response/u,
  );
  const inconsistent = reviewBatch(value);
  inconsistent.coverage.code['accept-header-presence'] = 'PASS';
  assert.throws(
    () =>
      assertReviewBatch({
        head_sha: head,
        preflight: value,
        reviews,
        review_batch: inconsistent,
      }),
    /verdict|final response/u,
  );
});

test('two blocked heads require a fresh implementer generation', () => {
  assert.equal(
    requireFreshImplementer({
      blocked_heads_since_refresh: 1,
      implementer_generation: 1,
      fresh_implementer: false,
      reported_generation: 1,
    }),
    1,
  );
  assert.throws(
    () =>
      requireFreshImplementer({
        blocked_heads_since_refresh: 2,
        implementer_generation: 1,
        fresh_implementer: false,
        reported_generation: 1,
      }),
    /fresh implementer/u,
  );
  assert.equal(
    requireFreshImplementer({
      blocked_heads_since_refresh: 2,
      implementer_generation: 1,
      fresh_implementer: true,
      reported_generation: 2,
      fresh_implementer_evidence: {
        task_id: 'st_fresh',
        dag_run_id: 'dag_issue-3305',
        dag_node_id: `implement-g2-${'a'.repeat(40)}`,
        dag_owner_fingerprint: 'f'.repeat(64),
      },
    }),
    2,
  );
});

test('canonical verification lease excludes concurrent artifact producers', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-policy-')));
  try {
    withCanonicalVerificationLease(root, 'lane-a', 3305, root, () => {
      assert.throws(
        () =>
          withCanonicalVerificationLease(
            root,
            'lane-b',
            3306,
            root,
            () => {},
          ),
        /already running/u,
      );
    });
    assert.equal(
      withCanonicalVerificationLease(
        root,
        'lane-a',
        3305,
        root,
        () => 'passed',
      ),
      'passed',
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

const leaseWorkerPath = fileURLToPath(
  new URL('./fixtures/canonical-verification-lease-worker.mjs', import.meta.url),
);
const canonicalVerificationCliPath = fileURLToPath(
  new URL('./canonical-verification.mjs', import.meta.url),
);
const verificationContainmentCliPath = fileURLToPath(
  new URL('./verification-containment.mjs', import.meta.url),
);
const externalPackageFixtureRoot = fileURLToPath(
  new URL('../../../../tooling/governance/fixtures/execute-lane-native/canonical-verification-external/', import.meta.url),
);

const nextChildMessage = async (child) =>
  (await once(child, 'message', { signal: AbortSignal.timeout(5_000) }))[0];

const startLeaseWorker = async ({
  runtimeRoot,
  laneId,
  issueNumber,
  worktree,
  staleOwnerPath,
}) => {
  const args = [runtimeRoot, laneId, String(issueNumber), worktree];
  if (staleOwnerPath !== undefined) {
    args.push(staleOwnerPath);
  }
  const child = fork(leaseWorkerPath, args, {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc', 'pipe'],
  });
  assert.deepEqual(await nextChildMessage(child), { type: 'ready' });
  return child;
};

const releaseLeaseWorker = async (child) => {
  child.send('release');
  const message = await nextChildMessage(child);
  await once(child, 'exit', { signal: AbortSignal.timeout(5_000) });
  return message;
};

test('canonical verification stale takeover is token-safe', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-stale-')));
  try {
    const stale = acquireCanonicalVerificationLease(root, 'lane-a', 3305, root);
    const ownerPath = join(stale.lock_path, 'owner.json');
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    writeFileSync(ownerPath, `${JSON.stringify({ ...owner, pid: 2_147_483_647 })}\n`);

    const replacement = acquireCanonicalVerificationLease(
      root,
      'lane-b',
      3306,
      root,
    );
    assert.equal(releaseCanonicalVerificationLease(stale), false);
    assert.throws(
      () => acquireCanonicalVerificationLease(root, 'lane-c', 3307, root),
      /already running/u,
    );
    assert.equal(
      releaseCanonicalVerificationLease({
        ...replacement,
        token: '00000000-0000-0000-0000-000000000000',
      }),
      false,
    );
    assert.throws(
      () => acquireCanonicalVerificationLease(root, 'lane-c', 3307, root),
      /already running/u,
    );
    assert.equal(releaseCanonicalVerificationLease(replacement), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('canonical verification lease distinguishes PID reuse from the live owner fingerprint', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-pid-reuse-')));
  let currentFingerprint = 'owner-start-a';
  const processIdentity = (pid) => pid === process.pid ? currentFingerprint : null;
  try {
    const stale = acquireCanonicalVerificationLease(
      root,
      'lane-a',
      3305,
      root,
      { process_identity: processIdentity },
    );
    assert.throws(
      () => acquireCanonicalVerificationLease(
        root,
        'lane-b',
        3306,
        root,
        { process_identity: processIdentity },
      ),
      /already running/u,
    );

    currentFingerprint = 'unrelated-reused-pid-start-b';
    const replacement = acquireCanonicalVerificationLease(
      root,
      'lane-b',
      3306,
      root,
      { process_identity: processIdentity },
    );
    assert.equal(releaseCanonicalVerificationLease(stale), false);
    assert.equal(releaseCanonicalVerificationLease(replacement), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('canonical verification lease never reclaims an inconclusive live PID', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-inconclusive-')));
  const identities = new Map([[101, 'owner-start'], [202, 'replacement-start']]);
  const alive = new Set([101, 202]);
  const processIdentity = (pid) => identities.get(pid) ?? null;
  try {
    const first = acquireCanonicalVerificationLease(root, 'lane-a', 3305, root, {
      pid: 101,
      process_identity: processIdentity,
      process_alive: (pid) => alive.has(pid),
    });
    identities.delete(101);
    assert.throws(
      () => acquireCanonicalVerificationLease(root, 'lane-b', 3306, root, {
        pid: 202,
        process_identity: processIdentity,
        process_alive: (pid) => alive.has(pid),
      }),
      /already running/u,
    );
    alive.delete(101);
    const replacement = acquireCanonicalVerificationLease(root, 'lane-b', 3306, root, {
      pid: 202,
      process_identity: processIdentity,
      process_alive: (pid) => alive.has(pid),
    });
    assert.equal(releaseCanonicalVerificationLease(first), false);
    assert.equal(releaseCanonicalVerificationLease(replacement), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('two stale recovery contenders elect one active owner', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-race-')));
  const children = [];
  try {
    const stale = acquireCanonicalVerificationLease(root, 'lane-stale', 3305, root);
    const ownerPath = join(stale.lock_path, 'owner.json');
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    writeFileSync(ownerPath, `${JSON.stringify({ ...owner, pid: 2_147_483_647 })}\n`);
    children.push(
      await startLeaseWorker({ runtimeRoot: root, laneId: 'lane-a', issueNumber: 3305, worktree: root, staleOwnerPath: ownerPath }),
      await startLeaseWorker({ runtimeRoot: root, laneId: 'lane-b', issueNumber: 3306, worktree: root, staleOwnerPath: ownerPath }),
    );
    const observations = children.map((child) => nextChildMessage(child));
    children.forEach((child) => child.send('start'));
    const observed = await Promise.all(observations);
    assert.deepEqual(
      observed.map(({ type }) => type),
      ['stale-observed', 'stale-observed'],
    );
    const messages = children.map((child) => nextChildMessage(child));
    children.forEach((child) => child.stdio[4].write('g'));
    const outcomes = await Promise.all(messages);
    assert.equal(outcomes.filter(({ type }) => type === 'acquired').length, 1);
    assert.equal(outcomes.filter(({ type }) => type === 'rejected').length, 1);
    assert.match(outcomes.find(({ type }) => type === 'rejected').message, /already running/u);
    assert.equal(releaseCanonicalVerificationLease(stale), false);
    const releases = await Promise.all(children.map(releaseLeaseWorker));
    assert.equal(releases.filter(({ released }) => released).length, 1);
    children.length = 0;
  } finally {
    children.forEach((child) => child.kill('SIGKILL'));
    rmSync(root, { force: true, recursive: true });
  }
});

test('different canonical worktrees acquire independently', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-independent-')));
  const worktreeA = join(root, 'worktree-a');
  const worktreeB = join(root, 'worktree-b');
  mkdirSync(worktreeA);
  mkdirSync(worktreeB);
  const children = [];
  try {
    children.push(
      await startLeaseWorker({ runtimeRoot: root, laneId: 'lane-a', issueNumber: 3305, worktree: worktreeA }),
      await startLeaseWorker({ runtimeRoot: root, laneId: 'lane-b', issueNumber: 3306, worktree: worktreeB }),
    );
    const messages = children.map((child) => nextChildMessage(child));
    children.forEach((child) => child.send('start'));
    const outcomes = await Promise.all(messages);
    assert.deepEqual(outcomes.map(({ type }) => type), ['acquired', 'acquired']);
    const releases = await Promise.all(children.map(releaseLeaseWorker));
    assert.deepEqual(releases.map(({ released }) => released), [true, true]);
    children.length = 0;
  } finally {
    children.forEach((child) => child.kill('SIGKILL'));
    rmSync(root, { force: true, recursive: true });
  }
});

test('canonical verification uses a clean contained exact-head workspace and reaps detached children', () => {
  const help = spawnSync(process.execPath, [canonicalVerificationCliPath, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /-- pnpm verify/u);

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-review-runner-')));
  const runtimeRoot = join(root, '.omo', 'lane-runs');
  const worktree = join(root, '.worktrees', 'issue-3305-content-negotiation');
  const originalPath = process.env.PATH;
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@fluo.dev']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Fixture']);
    execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/fluojs/fluo.git']);
    writeFileSync(join(root, 'package.json'), readFileSync(join(externalPackageFixtureRoot, 'package.json')));
    writeFileSync(join(root, 'pnpm-lock.yaml'), readFileSync(join(externalPackageFixtureRoot, 'pnpm-lock.yaml')));
    writeFileSync(join(root, 'fixture.txt'), 'fixture\n');
    writeFileSync(join(root, 'verify.mjs'), `
      import { fork } from 'node:child_process';
      import pc from 'picocolors';
      import { writeFileSync } from 'node:fs';
      const externalSource = import.meta.resolve('picocolors');
      if (!process.cwd().includes('.canonical-verify-')) process.exit(11);
      if (!externalSource.includes('.canonical-verify-') || !externalSource.includes('node_modules') || typeof pc.green !== 'function') process.exit(14);
      const child = fork(new URL('./verify-detached.mjs', import.meta.url), [], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const timeout = setTimeout(() => process.exit(12), 2000);
      child.once('message', (message) => {
        clearTimeout(timeout);
        if (message !== 'blocked') process.exit(13);
        child.disconnect();
      });
      child.unref();
    `);
    writeFileSync(join(root, 'verify-detached.mjs'), `
      import { writeFileSync } from 'node:fs';
      let blocked = 0;
      for (const path of [${JSON.stringify(join(root, 'fixture.txt'))}, ${JSON.stringify(join(root, '.omo', 'protected.txt'))}]) {
        try { writeFileSync(path, 'forged\\n'); } catch { blocked += 1; }
      }
      if (blocked === 2 && process.send) process.send('blocked');
      process.on('disconnect', () => setInterval(() => {}, 1000));
    `);
    writeFileSync(join(root, '.npmrc'), `virtual-store-dir=${join(root, '.omo', 'forged-store')}\n`);
    writeFileSync(join(root, '.pnpmfile.cjs'), `if (process.argv.includes('install')) require('node:fs').writeFileSync(${JSON.stringify(join(root, '.omo', 'pnpmfile-forgery'))}, 'forged\\n'); module.exports = {};\n`);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'fixture']);
    const startingHead = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    mkdirSync(join(root, '.worktrees'), { recursive: true });
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', '-b', supervisorIdentity.branch, worktree, startingHead]);
    prepareCanonicalV2Runtime({ repository_root: root, lane_id: 'lane-a', issue_numbers: [3305] });
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const gh = join(bin, 'gh');
    const issue = JSON.stringify({ number: 3305, url: 'https://github.com/fluojs/fluo/issues/3305', title: 'Fixture issue', body: '## Acceptance Criteria\n- [ ] Preserve canonical verification.', updatedAt: '2026-08-26T00:00:00Z' });
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${issue}'\n`);
    chmodSync(gh, 0o755);
    process.env.PATH = `${bin}:${originalPath}`;
    let canonicalBundle = initialiseIssueSupervisorStore(runtimeRoot, {
      ...supervisorIdentity, starting_head_sha: startingHead, repository_root: root,
      parent_session_id:
        process.env.PI_SESSION_ID ?? supervisorIdentity.parent_session_id,
      issue_contract_revision: undefined, issue_contract_sha256: undefined, lane_plan_approval_sha256: undefined,
    });
    const authority = canonicalBundle.snapshot.preflight_authority;
    const criterion = authority.canonical_acceptance_criteria[0];
    const canonicalPreflight = createReviewPreflight({
      lane_id: 'lane-a', issue_number: 3305, issue_contract_revision: authority.issue_contract_revision,
      issue_contract_sha256: authority.issue_contract_sha256, lane_plan_approval_sha256: authority.lane_plan_approval_sha256,
      head_sha: startingHead, generated_at: '2026-08-26T00:00:01.000Z', approved_sources: authority.canonical_sources,
      acceptance_row_ids: [criterion.id], rows: [{
        id: criterion.id, acceptance_text: criterion.content, acceptance_sha256: criterion.content_sha256,
        source: authority.canonical_sources[4].source, source_bindings: authority.canonical_sources,
        invariant: criterion.content, surfaces: ['canonical verification'], positive_cases: ['contained verification passes'],
        negative_cases: ['canonical mutation is denied'], boundary_cases: ['exact clean head and workspace links'],
      }],
      nonfunctional: { complexity: 'Bounded.', memory: 'Bounded.', atomicity: 'Receipt after checks.', mutation_boundary: 'Disposable only.' },
    });
    canonicalBundle = applyIssueSupervisorTransition(runtimeRoot, 'lane-a', 3305, { kind: 'preflight-completed', preflight: canonicalPreflight });
    canonicalBundle = applyIssueSupervisorTransition(runtimeRoot, 'lane-a', 3305, {
      kind: 'coordinator-rolled-over',
      coordinator_session_id: 'ses_parent_rollover',
    });
    writeFileSync(join(root, '.omo', 'protected.txt'), 'protected\n');

    assert.equal(runCanonicalVerification({
      repository_root: root, runtime_root: runtimeRoot, lane_id: 'lane-a', issue_number: 3305,
      parent_session_id: canonicalBundle.snapshot.active_coordinator_session_id,
      cwd: worktree, head_sha: startingHead, preflight_sha256: canonicalPreflight.sha256,
      task_id: 'st_contained', command: 'pnpm', command_args: ['verify'],
    }), 0);
    assert.equal(readFileSync(join(worktree, 'fixture.txt'), 'utf8'), 'fixture\n');
    assert.equal(readFileSync(join(root, '.omo', 'protected.txt'), 'utf8'), 'protected\n');
    assert.equal(existsSync(join(root, '.omo', 'forged-store')), false);
    assert.equal(existsSync(join(root, '.omo', 'pnpmfile-forgery')), false);
    const receipt = JSON.parse(readFileSync(join(runtimeRoot, 'lane-a', 'issues', '3305', 'canonical-verification', 'st_contained.json'), 'utf8'));
    assert.equal(receipt.version, 2);
    assert.equal(receipt.head_sha, startingHead);
    assert.match(receipt.tree_sha, /^[a-f0-9]{40}$/u);
    assert.match(receipt.input_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.pnpm_store_path, join(runtimeRoot, 'pnpm-store'));
    assert.match(receipt.lockfile_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.command.join(' '), 'pnpm verify');
    assert.equal(existsSync(receipt.execution_worktree), false);
    assert.equal(execFileSync('git', ['-C', worktree, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }), '');
    assert.throws(() => runCanonicalVerification({
      repository_root: root, runtime_root: runtimeRoot, lane_id: 'lane-a', issue_number: 3305,
      parent_session_id: canonicalBundle.snapshot.parent_session_id,
      cwd: worktree, head_sha: startingHead, preflight_sha256: canonicalPreflight.sha256,
      task_id: 'st_not_canonical', command: process.execPath, command_args: ['-e', 'process.exit(0)'],
    }), /exactly pnpm verify/u);
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { force: true, recursive: true });
  }
});

test('canonical verification fails closed for unavailable or symlinked host stores', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-store-authority-')));
  const realStore = join(root, 'real-store');
  const runtimeRoot = join(root, 'runtime');
  mkdirSync(realStore);
  mkdirSync(runtimeRoot);
  symlinkSync(realStore, join(runtimeRoot, 'pnpm-store'));
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ private: true, packageManager: 'pnpm@10.4.1' }),
  );
  try {
    assert.throws(
      () => resolveTrustedPnpmStore(root, root, runtimeRoot),
      /real canonical directory/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('canonical verification receipt publication rejects stale symlink redirects', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-receipt-symlink-')));
  const runtimeRoot = join(root, 'runtime');
  const issueRoot = join(runtimeRoot, 'lane-a', 'issues', '3305');
  const redirect = join(root, 'redirect');
  mkdirSync(issueRoot, { recursive: true });
  mkdirSync(redirect);
  try {
    symlinkSync(redirect, join(issueRoot, 'canonical-verification'));
    assert.throws(
      () => publishCanonicalVerificationReceipt(runtimeRoot, 'lane-a', 3305, 'st_redirect', { result: 'pass' }),
      /receipt directory must be a real canonical directory/u,
    );
    assert.deepEqual(readdirSync(redirect), []);

    rmSync(join(issueRoot, 'canonical-verification'));
    rmSync(issueRoot, { recursive: true });
    symlinkSync(redirect, issueRoot);
    assert.throws(
      () => publishCanonicalVerificationReceipt(runtimeRoot, 'lane-a', 3305, 'st_issue_redirect', { result: 'pass' }),
      /issue directory must be a real canonical directory/u,
    );
    assert.deepEqual(readdirSync(redirect), []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('instant detached descendants remain confined from authority files and protected processes', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-instant-detach-')));
  const disposableRoot = join(root, 'disposable');
  const runtimeRoot = join(disposableRoot, 'runtime');
  const canonicalRoot = join(root, 'canonical');
  const canonicalFile = join(canonicalRoot, 'tracked.txt');
  const canonicalOmo = join(canonicalRoot, '.omo', 'authority.txt');
  const attemptMarker = join(runtimeRoot, 'detached-attempt.json');
  const protectedMarker = join(canonicalRoot, 'protected-signal.txt');
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(join(canonicalRoot, '.omo'), { recursive: true });
  writeFileSync(canonicalFile, 'canonical\n');
  writeFileSync(canonicalOmo, 'authority\n');
  writeFileSync(join(canonicalRoot, 'protected.mjs'), `
    import { existsSync, writeFileSync } from 'node:fs';
    let signalled = false;
    process.on('SIGUSR1', () => { signalled = true; writeFileSync(${JSON.stringify(protectedMarker)}, 'signalled\\n'); });
    process.on('message', (message) => {
      if (message === 'ping') process.send?.({ type: 'status', signalled, marker: existsSync(${JSON.stringify(protectedMarker)}) });
      if (message === 'release') process.exit(0);
    });
    process.send?.({ type: 'ready' });
  `);
  const protectedProcess = fork(join(canonicalRoot, 'protected.mjs'), [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  try {
    assert.deepEqual(await nextChildMessage(protectedProcess), { type: 'ready' });
    writeFileSync(join(disposableRoot, 'package.json'), JSON.stringify({
      name: 'instant-detach-fixture', private: true, type: 'module',
      scripts: { verify: 'node foreground.mjs' },
    }));
    writeFileSync(join(disposableRoot, 'foreground.mjs'), `
      import { fork } from 'node:child_process';
      const launcher = fork(new URL('./launcher.mjs', import.meta.url), [], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      launcher.unref();
      launcher.channel?.unref();
    `);
    writeFileSync(join(disposableRoot, 'launcher.mjs'), `
      import { fork } from 'node:child_process';
      process.on('disconnect', () => {
        const daemon = fork(new URL('./daemon.mjs', import.meta.url), [], { detached: true, stdio: 'ignore' });
        daemon.unref();
      });
    `);
    writeFileSync(join(disposableRoot, 'daemon.mjs'), `
      import { writeFileSync } from 'node:fs';
      const results = [];
      for (const path of [${JSON.stringify(canonicalFile)}, ${JSON.stringify(canonicalOmo)}]) {
        try { writeFileSync(path, 'forged\\n'); results.push('wrote'); } catch { results.push('blocked'); }
      }
      try { process.kill(${String(protectedProcess.pid)}, 'SIGUSR1'); results.push('signalled'); } catch { results.push('blocked'); }
      writeFileSync(${JSON.stringify(attemptMarker)}, JSON.stringify(results));
    `);
    const lockfile = 'lockfileVersion: 9.0\n';
    writeFileSync(join(disposableRoot, 'pnpm-lock.yaml'), lockfile);
    const storePath = execFileSync('pnpm', ['store', 'path'], { encoding: 'utf8' }).trim();
    const requestPath = join(runtimeRoot, 'request.json');
    writeFileSync(requestPath, JSON.stringify({
      disposable_root: disposableRoot,
      runtime_root: runtimeRoot,
      phase: 'verify',
      pnpm_store_path: storePath,
      lockfile_sha256: createHash('sha256').update(lockfile).digest('hex'),
    }));
    const wrapper = spawn(process.execPath, [verificationContainmentCliPath, requestPath], {
      cwd: disposableRoot,
      stdio: 'ignore',
    });
    const wrapperExit = once(wrapper, 'exit', { signal: AbortSignal.timeout(5_000) });
    const [status, signal] = await wrapperExit;
    assert.equal(status, 0);
    assert.equal(signal, null);
    if (existsSync(attemptMarker)) {
      assert.deepEqual(
        JSON.parse(readFileSync(attemptMarker, 'utf8')),
        ['blocked', 'blocked', 'blocked'],
      );
    }
    assert.equal(readFileSync(canonicalFile, 'utf8'), 'canonical\n');
    assert.equal(readFileSync(canonicalOmo, 'utf8'), 'authority\n');
    protectedProcess.send('ping');
    assert.deepEqual(await nextChildMessage(protectedProcess), { type: 'status', signalled: false, marker: false });
  } finally {
    if (protectedProcess.exitCode === null && protectedProcess.signalCode === null) {
      const protectedExit = once(protectedProcess, 'exit', { signal: AbortSignal.timeout(5_000) });
      protectedProcess.send?.('release');
      await protectedExit.catch(() => protectedProcess.kill('SIGKILL'));
    }
    rmSync(root, { force: true, recursive: true });
  }
});

test('verification containment cleans its process tree on signal before returning', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-containment-signal-')));
  const runtimeRoot = join(root, 'runtime');
  const marker = join(root, 'ready.json');
  const protectedPath = join(realpathSync(tmpdir()), `fluo-containment-protected-${String(process.pid)}.txt`);
  mkdirSync(runtimeRoot);
  try {
    writeFileSync(protectedPath, 'protected\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'containment-signal-fixture', private: true, type: 'module',
      scripts: { verify: 'node parent.mjs' },
    }));
    writeFileSync(join(root, 'parent.mjs'), `
      import { fork } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const child = fork(new URL('./daemon.mjs', import.meta.url), [], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child.once('message', () => writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: child.pid })));
      child.unref();
      setInterval(() => {}, 1000);
    `);
    writeFileSync(join(root, 'daemon.mjs'), `
      import { writeFileSync } from 'node:fs';
      try { writeFileSync(${JSON.stringify(protectedPath)}, 'forged\\n'); } catch {}
      if (process.send) process.send('ready');
      process.disconnect();
      setInterval(() => {}, 1000);
    `);
    const lockfile = 'lockfileVersion: 9.0\n';
    writeFileSync(join(root, 'pnpm-lock.yaml'), lockfile);
    const storePath = execFileSync('pnpm', ['store', 'path'], { encoding: 'utf8' }).trim();
    const requestPath = join(runtimeRoot, 'request.json');
    writeFileSync(requestPath, JSON.stringify({
      disposable_root: root,
      runtime_root: runtimeRoot,
      phase: 'verify',
      pnpm_store_path: storePath,
      lockfile_sha256: createHash('sha256').update(lockfile).digest('hex'),
    }));
    const markerReady = new Promise((resolvePromise, reject) => {
      const watcher = watch(root, (_event, filename) => {
        if (filename === 'ready.json') {
          watcher.close();
          resolvePromise(undefined);
        }
      });
      const timeout = setTimeout(() => {
        watcher.close();
        reject(new Error('containment child marker timeout'));
      }, 5_000);
      watcher.once('close', () => clearTimeout(timeout));
    });
    const wrapper = spawn(process.execPath, [verificationContainmentCliPath, requestPath], {
      cwd: root,
      stdio: 'ignore',
    });
    await markerReady;
    const daemonPid = JSON.parse(readFileSync(marker, 'utf8')).pid;
    wrapper.kill('SIGTERM');
    const [status, signal] = await once(wrapper, 'exit', { signal: AbortSignal.timeout(5_000) });
    assert.equal(status, null);
    assert.equal(signal, 'SIGTERM');
    assert.throws(() => process.kill(daemonPid, 0), (error) => error?.code === 'ESRCH');
    assert.equal(readFileSync(protectedPath, 'utf8'), 'protected\n');
  } finally {
    rmSync(protectedPath, { force: true });
    rmSync(root, { force: true, recursive: true });
  }
});

const supervisorIdentity = {
  lane_id: 'lane-a',
  issue_number: 3305,
  branch: 'issue-3305-content-negotiation',
  worktree: '.worktrees/issue-3305-content-negotiation',
  starting_head_sha: head,
  started_at: '2026-08-26T00:00:00.000Z',
  review_policy: 'preflight-v1',
  repository_root: reviewRepositoryRoot,
  parent_session_id: 'ses_parent',
  issue_contract_revision: 'issue-3305@1',
  issue_contract_sha256: '1'.repeat(64),
  lane_plan_approval_sha256: '2'.repeat(64),
  authority_scope: {
    pr_creation: true,
    pr_merge: true,
    cleanup_command_worktrees: true,
  },
  retry_policy: {
    retry_count_is_terminal: false,
    max_same_failure_repeats: null,
    max_wall_clock_minutes: null,
    stop_on_child_contract_error: true,
  },
};

const remediatedBlockers = () =>
  reviews[1].blockers.map((blocker) => ({
    ...blocker,
    status: 'remediated',
  }));

const implementationStep = (state, newHead, verification = 'focused tests passed') => {
  const taskId = `st_implement${String(state.issue_number)}${newHead.slice(0, 8)}`;
  const dagRunId = `dag_issue-${String(state.issue_number)}`;
  const dagKey =
    `fluo:lane:${state.lane_id}:issue-${String(state.issue_number)}:lifecycle:v3`;
  const nodeId =
    `implement-g${String(state.implementer_generation)}-${state.head_sha}`;
  const ownerFingerprint = payloadDigest(nodeId);
  writeActualShapedImplementerTask({
    repository_root: state.repository_root,
    task_id: taskId,
    parent_session_id: state.parent_session_id,
    lane_id: state.lane_id,
    issue_number: state.issue_number,
    worktree: state.worktree,
    current_head: state.head_sha,
    new_head: newHead,
    generation: state.implementer_generation,
    result: 'implementation-completed',
    verification,
    preflight_sha256: state.review_preflight.sha256,
    authoritative_preflight: state.review_preflight,
    dag_run_id: dagRunId,
    dag_key: dagKey,
    node_id: nodeId,
    dag_owner_fingerprint: ownerFingerprint,
  });
  return {
    kind: 'implementation-completed',
    new_head: newHead,
    verification,
    implementer_generation: state.implementer_generation,
    implementer_evidence: {
      task_id: taskId,
      dag_run_id: dagRunId,
      dag_node_id: nodeId,
      dag_owner_fingerprint: ownerFingerprint,
    },
  };
};

const fixStep = (state, newHead, generation = state.implementer_generation) => {
  const addressedBlockers = remediatedBlockers();
  const taskId = `st_fix${String(state.issue_number)}${newHead.slice(0, 8)}`;
  const dagRunId = `dag_issue-${String(state.issue_number)}`;
  const dagKey =
    `fluo:lane:${state.lane_id}:issue-${String(state.issue_number)}:lifecycle:v3`;
  const nodeId = `implement-g${String(generation)}-${state.head_sha}`;
  const ownerFingerprint = payloadDigest(nodeId);
  writeActualShapedImplementerTask({
    repository_root: state.repository_root,
    task_id: taskId,
    parent_session_id: state.parent_session_id,
    lane_id: state.lane_id,
    issue_number: state.issue_number,
    worktree: state.worktree,
    current_head: state.head_sha,
    new_head: newHead,
    generation,
    result: 'fix-completed',
    verification: 'focused tests passed',
    addressed_blockers: addressedBlockers,
    blocker_ledger: state.blocker_ledger,
    unresolved_blockers: state.blocker_ledger.filter(
      (entry) => entry.remediation_status === 'unresolved',
    ),
    preflight_sha256: state.review_preflight.sha256,
    authoritative_preflight: state.review_preflight,
    dag_run_id: dagRunId,
    dag_key: dagKey,
    node_id: nodeId,
    dag_owner_fingerprint: ownerFingerprint,
  });
  return {
    kind: 'fix-completed',
    new_head: newHead,
    verification: 'focused tests passed',
    observed_at: '2026-08-26T00:05:00.000Z',
    addressed_blockers: addressedBlockers,
    fresh_implementer: generation !== state.implementer_generation,
    implementer_generation: generation,
    implementer_evidence: {
      task_id: taskId,
      dag_run_id: dagRunId,
      dag_node_id: nodeId,
      dag_owner_fingerprint: ownerFingerprint,
    },
  };
};

test('v2 supervisor gates implementation and fix-back on preflight policy', () => {
  const matrix = preflight();
  const initial = createIssueSupervisor(supervisorIdentity);
  assert.equal(initial.version, 2);
  assert.equal(initial.status, 'preflight');
  assert.throws(
    () =>
      transitionIssueSupervisor(initial, {
        kind: 'implementation-completed',
        new_head: 'b'.repeat(40),
        verification: 'focused tests passed',
      }),
    /preflight/u,
  );
  assert.throws(
    () =>
      transitionIssueSupervisor(initial, {
        kind: 'preflight-completed',
        preflight: createReviewPreflight({
          ...matrix,
          issue_contract_sha256: '3'.repeat(64),
        }),
      }),
    /issue contract/u,
  );

  const implementing = transitionIssueSupervisor(initial, {
    kind: 'preflight-completed',
    preflight: matrix,
  });
  assert.equal(implementing.status, 'implementing');

  const localReview = transitionIssueSupervisor(
    implementing,
    implementationStep(implementing, 'b'.repeat(40)),
  );
  const sameHeadReviews = reviews.map((review) => ({
    ...review,
    reviewed_head_sha: 'b'.repeat(40),
  }));
  assert.throws(
    () =>
      transitionIssueSupervisor(localReview, {
        kind: 'local-review',
        reviews: sameHeadReviews,
      }),
    /review batch/u,
  );

  const blockedOnce = transitionIssueSupervisor(localReview, {
    kind: 'local-review',
    reviews: sameHeadReviews,
    review_batch: reviewBatch(matrix, 'b'.repeat(40)),
  });
  assert.equal(blockedOnce.status, 'implementing');
  assert.equal(blockedOnce.blocked_heads_since_refresh, 1);

  const secondHead = transitionIssueSupervisor(
    blockedOnce,
    fixStep(blockedOnce, 'c'.repeat(40)),
  );
  const secondReviews = reviews.map((review) => ({
    ...review,
    reviewed_head_sha: 'c'.repeat(40),
  }));
  const blockedTwice = transitionIssueSupervisor(secondHead, {
    kind: 'local-review',
    reviews: secondReviews,
    review_batch: reviewBatch(matrix, 'c'.repeat(40)),
  });
  assert.equal(blockedTwice.blocked_heads_since_refresh, 2);
  assert.throws(
    () => transitionIssueSupervisor(blockedTwice, {
      ...fixStep(blockedTwice, 'd'.repeat(40), 2),
      observed_at: '2026-08-26T00:04:00.000Z',
    }),
    /stale, future, or out of sequence/u,
  );
  assert.throws(
    () => transitionIssueSupervisor(
      blockedTwice,
      {
        ...fixStep(blockedTwice, 'd'.repeat(40), 2),
        observed_at: '2026-08-26T00:10:00.000Z',
      },
      { now: Date.parse('2026-08-26T00:09:59.999Z') },
    ),
    /stale, future, or out of sequence/u,
  );
  assert.throws(
    () =>
      transitionIssueSupervisor(blockedTwice, {
        kind: 'fix-completed',
        new_head: 'd'.repeat(40),
        verification: 'focused tests passed',
        observed_at: '2026-08-26T00:10:00.000Z',
        addressed_blockers: remediatedBlockers(),
        fresh_implementer: false,
        implementer_generation: 1,
      }),
    /fresh implementer/u,
  );
});

const conflictDigests = () => ({
  old_content_sha256: '3'.repeat(64),
  upstream_content_sha256: '4'.repeat(64),
  resolved_content_sha256: '5'.repeat(64),
  old_upstream_diff_sha256: '6'.repeat(64),
  old_resolved_diff_sha256: '7'.repeat(64),
  upstream_resolved_diff_sha256: '8'.repeat(64),
});

const writeConflictTask = (
  gate,
  task_id = 'st_conflict_gate',
  overrides = {},
  taskRepositoryRoot = reviewRepositoryRoot,
  digests = conflictDigests(),
  machineEvidence = null,
  dag = null,
) => {
  const taskRoot = join(taskRepositoryRoot, '.omo', 'senpi-task', 'tasks');
  mkdirSync(taskRoot, { recursive: true });
  const canonicalGate = { generation: 1, ...gate };
  const nodeId =
    `conflict-gate-g1-h${gate.resolved_head}` +
    `-from${gate.previously_reviewed_head}-u${gate.upstream_head}`;
  const task = {
    task_id,
    status: 'completed',
    parent_session_id: 'ses_parent',
    agent_type: 'fluo-contract-reviewer',
    resolved_model: {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-sol',
      source: 'category',
      variant: 'medium',
    },
    name:
      dag === null
        ? conflictReviewerTaskName(3305, gate.resolved_head)
        : nodeId,
    ...(dag === null
      ? {}
      : {
          owner: {
            kind: 'dag',
            runId: dag.run_id,
            nodeId,
            fingerprint: createHash('sha256').update(nodeId).digest('hex'),
          },
        }),
    final_response: formatSenpiFinalResponse(
      'fluo:execute-lane:conflict-review:final:v1',
      {
        sentinel: 'fluo:execute-lane:conflict-review:final:v1',
        verdict_signal: 'PASS',
        ...canonicalGate,
        digests,
      },
    ),
    spawn_spec: {
      cwd: taskRepositoryRoot,
      prompt: `Review conflict resolution without mutation.\n${conflictReviewerPromptSentinel({
        repository_root: taskRepositoryRoot,
        lane_id: 'lane-a',
        issue_number: 3305,
        worktree: '.worktrees/issue-3305-content-negotiation',
        ...canonicalGate,
        machine_evidence: machineEvidence,
        ...(dag === null
          ? {}
          : {
              dag_key: dag.dag_key,
              node_id: nodeId,
            }),
      })}`,
    },
    ...overrides,
  };
  writeActualShapedReviewerTask({
    task,
    repository_root: taskRepositoryRoot,
    expected: {
      task_id,
      parent_session_id: 'ses_parent',
      lane_id: 'lane-a',
      issue_number: 3305,
      worktree: '.worktrees/issue-3305-content-negotiation',
      preflight_sha256: gate.preflight_sha256,
      axis: 'conflict',
    },
    verify: false,
  });
  return task;
};

const writeRerunTask = (axis, reviewedHead, task_id, malformed = {}) => {
  const taskRoot = join(reviewRepositoryRoot, '.omo', 'senpi-task', 'tasks');
  mkdirSync(taskRoot, { recursive: true });
  const canonicalVerificationReceiptId =
    `st_parent_verify_${reviewedHead.slice(0, 12)}`;
  const task = {
    task_id,
    status: 'completed',
    parent_session_id: 'ses_parent',
    agent_type: {
      contract: 'fluo-contract-reviewer',
      code: 'fluo-code-reviewer',
      verification: 'fluo-verification-reviewer',
    }[axis],
    resolved_model: {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-sol',
      source: 'category',
      variant: 'medium',
    },
    name: reviewerTaskName(axis, 3305, reviewedHead),
    final_response: formatSenpiFinalResponse(
      'fluo:execute-lane:review:final:v1',
      {
        sentinel: 'fluo:execute-lane:review:final:v1',
        axis,
        head_sha: reviewedHead,
        preflight_sha256: preflight().sha256,
        verdict_signal: 'PASS',
        coverage: { 'accept-header-presence': 'PASS' },
        blockers: [],
        blocker_sources: {},
      },
    ),
    spawn_spec: {
      cwd: reviewRepositoryRoot,
      prompt: `Review without mutation.\n${reviewerPromptSentinel({
        repository_root: reviewRepositoryRoot,
        lane_id: 'lane-a',
        issue_number: 3305,
        worktree: '.worktrees/issue-3305-content-negotiation',
        head_sha: reviewedHead,
        preflight_sha256: preflight().sha256,
        review_axis: axis,
        ...(axis === 'verification'
          ? {
              canonical_verification_receipt_id:
                canonicalVerificationReceiptId,
            }
          : {}),
      })}`,
    },
    ...malformed,
  };
  writeActualShapedReviewerTask({
    task,
    repository_root: reviewRepositoryRoot,
    expected: {
      task_id,
      parent_session_id: 'ses_parent',
      lane_id: 'lane-a',
      issue_number: 3305,
      worktree: '.worktrees/issue-3305-content-negotiation',
      branch: 'issue-3305-content-negotiation',
      head_sha: reviewedHead,
      preflight_sha256: preflight().sha256,
      axis,
      ...(axis === 'verification'
        ? {
            canonical_verification_receipt_id:
              canonicalVerificationReceiptId,
          }
        : {}),
    },
    verify: false,
  });
  return task;
};

const conflictGate = ({
  oldHead = 'b'.repeat(40),
  resolvedHead = 'c'.repeat(40),
  impact = 'mechanical',
  affectedAxes = [],
  upstreamRelevant = false,
} = {}) => ({
  preflight_sha256: preflight().sha256,
  previously_reviewed_head: oldHead,
  resolved_head: resolvedHead,
  upstream_head: 'd'.repeat(40),
  conflicting_files: ['package.json'],
  conflicting_hunks: ['package.json:10-14'],
  semantic_impact: impact,
  affected_axes: affectedAxes,
  upstream_relevant: upstreamRelevant,
  rationale: 'The resolved content has been compared with both parents.',
});

const conflictReadyState = () => {
  const matrix = preflight();
  let state = transitionIssueSupervisor(createIssueSupervisor(supervisorIdentity), {
    kind: 'preflight-completed',
    preflight: matrix,
  });
  state = transitionIssueSupervisor(
    state,
    implementationStep(state, 'b'.repeat(40)),
  );
  const passed = reviews.map((review) => ({
    ...review,
    reviewed_head_sha: 'b'.repeat(40),
    verdict_signal: 'PASS',
    blockers: [],
  }));
  state = transitionIssueSupervisor(state, {
    kind: 'local-review',
    reviews: passed,
    review_batch: {
      ...reviewBatch(matrix, 'b'.repeat(40), true),
      coverage: Object.fromEntries(
        ['contract', 'code', 'verification'].map((axis) => [axis, { 'accept-header-presence': 'PASS' }]),
      ),
      blocker_sources: {},
    },
  });
  state.pr = {
    number: 3305,
    url: 'https://github.com/fluojs/fluo/pull/3305',
    receipt: {
      kind: 'pr-create', authority: 'issue-supervisor', lane_id: 'lane-a', issue_number: 3305,
      branch: supervisorIdentity.branch, worktree: supervisorIdentity.worktree, head_sha: state.head_sha,
      observed_at: '2026-08-26T00:01:00.000Z', pr_number: 3305,
      pr_url: 'https://github.com/fluojs/fluo/pull/3305', remote_head_sha: state.head_sha,
      pr_head_sha: state.head_sha, pr_state: 'OPEN',
    },
  };
  state.status = 'conflict-resolution';
  state.conflict_receipt = {
    kind: 'pr-conflict', authority: 'issue-supervisor', lane_id: 'lane-a', issue_number: 3305,
    branch: supervisorIdentity.branch, worktree: supervisorIdentity.worktree, head_sha: state.head_sha,
    observed_at: '2026-08-26T00:02:00.000Z', pr_number: 3305,
    pr_url: 'https://github.com/fluojs/fluo/pull/3305', remote_head_sha: state.head_sha,
    pr_head_sha: state.head_sha, pr_state: 'OPEN', pr_mergeable: 'CONFLICTING',
    pr_merge_state_status: 'DIRTY', evidence: 'PR reports merge conflicts.',
  };
  const blocker = { reviewer: 'verification', signature: 'pr:merge-conflict', evidence: state.conflict_receipt.evidence, fix_back_eligible: true, status: 'unresolved' };
  state.blockers = [structuredClone(blocker)];
  appendObservedBlocker(
    state,
    blocker,
    state.conflict_receipt,
    'verified-pr-conflict-receipt',
    'compatibility',
  );
  return state;
};

test('conflict gate uses canonical receipts for mechanical and scoped resolutions', () => {
  for (const affectedAxis of [null, 'contract', 'code', 'verification']) {
    const state = conflictReadyState();
    const gate = conflictGate(
      affectedAxis === null
        ? {}
        : { impact: 'scoped', affectedAxes: [affectedAxis], upstreamRelevant: true },
    );
    const suffix = affectedAxis ?? 'mechanical';
    writeConflictTask(gate, `st_gate_${suffix}`);
    const rerun_task_ids = {};
    if (affectedAxis !== null) {
      rerun_task_ids[affectedAxis] = `st_rerun_${affectedAxis}`;
      writeRerunTask(affectedAxis, gate.resolved_head, rerun_task_ids[affectedAxis]);
    }
    applyConflictResolution(state, {
      gate,
      gate_task_id: `st_gate_${suffix}`,
      rerun_task_ids,
      ...(affectedAxis === 'verification'
        ? {
            canonical_verification_receipt_id:
              `st_parent_verify_${gate.resolved_head.slice(0, 12)}`,
          }
        : {}),
    });
    assert.equal(state.status, 'ready-for-push');
    assert.equal(state.head_sha, gate.resolved_head);
    assert.equal(state.conflict_receipt, null);
    assert.deepEqual(state.blockers, []);
    assert.equal(
      state.blocker_ledger.find(
        (entry) => entry.blocker.signature === 'pr:merge-conflict',
      ).remediation_status,
      'remediated',
    );
    assert.equal(
      state.conflict_resolution.axes.filter((item) => item.kind === 'rerun').length,
      affectedAxis === null ? 0 : 1,
    );
    assert.doesNotThrow(() => assertConflictResolutionEvidence(state));
  }
});

test('conflict gate rejects evidence from a substituted DAG run', () => {
  const state = conflictReadyState();
  const gate = conflictGate();
  const dagKey = 'fluo:lane:lane-a:issue-3305:lifecycle:v3';
  writeConflictTask(
    gate,
    'st_conflict_wrong_run',
    {},
    reviewRepositoryRoot,
    conflictDigests(),
    null,
    { run_id: 'dag_substituted', dag_key: dagKey },
  );

  assert.throws(
    () =>
      applyConflictResolution(state, {
        gate,
        gate_task_id: 'st_conflict_wrong_run',
        rerun_task_ids: {},
        dag_run_id: 'dag_current',
        dag_key: dagKey,
      }),
    /DAG owner/u,
  );
});

test('conflict gate reviewer is read-only and rejects shell tool evidence', () => {
  const state = conflictReadyState();
  const gate = conflictGate();
  writeConflictTask(gate, 'st_conflict_shell');
  const summaryPath = join(reviewRepositoryRoot, '.omo', 'senpi-task', 'logs', 'st_conflict_shell.jsonl');
  const summary = readFileSync(summaryPath, 'utf8').replace('"tool":"read"', '"tool":"bash"');
  writeFileSync(summaryPath, summary);
  const sessionRoot = join(
    reviewRepositoryRoot,
    '.omo', 'senpi-task', 'children', 'st_conflict_shell', 'sessions', 'st_conflict_shell',
  );
  const sessionPath = join(sessionRoot, readdirSync(sessionRoot)[0]);
  const session = readFileSync(sessionPath, 'utf8').replace('"name":"read"', '"name":"bash"');
  writeFileSync(sessionPath, session);
  assert.throws(
    () => applyConflictResolution(state, {
      gate,
      gate_task_id: 'st_conflict_shell',
      rerun_task_ids: {},
    }),
    /conflict reviewer used a forbidden|unknown tool/u,
  );
});

test('ambiguous and cross-cutting conflicts require a canonical full rerun', () => {
  for (const impact of ['ambiguous', 'cross-cutting']) {
    const state = conflictReadyState();
    const gate = conflictGate({
      impact,
      affectedAxes: ['contract', 'code', 'verification'],
      upstreamRelevant: true,
    });
    writeConflictTask(gate, `st_gate_${impact}`);
    const rerun_task_ids = Object.fromEntries(
      ['contract', 'code', 'verification'].map((axis) => {
        const id = `st_${impact}_${axis}`;
        writeRerunTask(axis, gate.resolved_head, id);
        return [axis, id];
      }),
    );
    applyConflictResolution(state, {
      gate,
      gate_task_id: `st_gate_${impact}`,
      rerun_task_ids,
      canonical_verification_receipt_id:
        `st_parent_verify_${gate.resolved_head.slice(0, 12)}`,
    });
    assert.equal(state.conflict_resolution.axes.every((item) => item.kind === 'rerun'), true);
  }
});

test('conflict reruns reject forged, missing, BLOCK, stale, cross-issue, and tampered evidence', () => {
  {
    const state = conflictReadyState();
    const gate = conflictGate({ impact: 'scoped', affectedAxes: ['contract'], upstreamRelevant: true });
    writeConflictTask(gate, 'st_gate_missing');
    assert.throws(
      () => applyConflictResolution(state, { gate, gate_task_id: 'st_gate_missing', rerun_task_ids: { contract: 'st_not_written' } }),
      /ENOENT|record/u,
    );
    assert.throws(
      () => applyConflictResolution(state, {
        gate,
        gate_task_id: 'st_gate_missing',
        rerun_task_ids: { contract: 'st_syntactic_only' },
        rerun_reviews: [{ reviewer: 'contract', reviewed_head_sha: gate.resolved_head, verdict_signal: 'PASS', blockers: [] }],
      }),
      /caller-provided/u,
    );
  }
  {
    const state = conflictReadyState();
    const gate = conflictGate({ impact: 'scoped', affectedAxes: ['code'], upstreamRelevant: true });
    writeConflictTask(gate, 'st_gate_block');
    const task = writeRerunTask('code', gate.resolved_head, 'st_block_rerun');
    mutateTaskOutput(task, 'fluo:execute-lane:review:final:v1', (output) => {
      output.verdict_signal = 'BLOCK';
      output.coverage['accept-header-presence'] = 'BLOCK';
    });
    writeFileSync(join(reviewRepositoryRoot, '.omo', 'senpi-task', 'tasks', 'st_block_rerun.json'), JSON.stringify(task));
    assert.throws(
      () => applyConflictResolution(state, { gate, gate_task_id: 'st_gate_block', rerun_task_ids: { code: 'st_block_rerun' } }),
      /provenance|verdict|blocker|complete PASS/u,
    );
  }
  {
    const state = conflictReadyState();
    const path = join(reviewRepositoryRoot, '.omo', 'senpi-task', 'tasks', 'st_contract.json');
    const task = JSON.parse(readFileSync(path, 'utf8'));
    const output = mutateTaskOutput(
      task,
      'fluo:execute-lane:review:final:v1',
      (payload) => {
        payload.verdict_signal = 'BLOCK';
        payload.coverage['accept-header-presence'] = 'BLOCK';
      },
    );
    writeFileSync(path, JSON.stringify(task));
    state.local_review.review_batch.reviewer_receipts.contract = {
      ...state.local_review.review_batch.reviewer_receipts.contract,
      record_sha256: payloadDigest(task),
      output_sha256: payloadDigest(output),
      final_response: output,
    };
    const gate = conflictGate();
    writeConflictTask(gate, 'st_gate_inherited_block');
    assert.throws(
      () => applyConflictResolution(state, { gate, gate_task_id: 'st_gate_inherited_block', rerun_task_ids: {} }),
      /complete PASS|canonical reviewer task/u,
    );
  }
  for (const mutate of [
    (state) => { state.local_review.review_batch.reviewer_receipts.contract.output_sha256 = '0'.repeat(64); },
    (state) => { state.local_review.review_batch.reviewer_receipts.contract.head_sha = '9'.repeat(40); },
    (state) => { state.local_review.review_batch.reviewer_receipts.contract.issue_number = 9999; },
  ]) {
    const state = conflictReadyState();
    mutate(state);
    const gate = conflictGate();
    writeConflictTask(gate, 'st_gate_bad_inherit');
    assert.throws(
      () => applyConflictResolution(state, { gate, gate_task_id: 'st_gate_bad_inherit', rerun_task_ids: {} }),
      /receipt|canonical/u,
    );
  }
});

test('classification, diff digest, and unresolved blocker tampering fail closed', () => {
  const state = conflictReadyState();
  const gate = conflictGate();
  writeConflictTask(gate, 'st_gate_tamper');
  const forgedGate = { ...gate, semantic_impact: 'scoped', affected_axes: ['contract'], upstream_relevant: true };
  assert.throws(
    () => applyConflictResolution(structuredClone(state), { gate: forgedGate, gate_task_id: 'st_gate_tamper', rerun_task_ids: { contract: 'st_fake' } }),
    /final_response|provenance/u,
  );
  applyConflictResolution(state, { gate, gate_task_id: 'st_gate_tamper', rerun_task_ids: {} });
  const forgedDigest = structuredClone(state);
  forgedDigest.conflict_resolution.digests.old_resolved_diff_sha256 = '0'.repeat(64);
  assert.throws(() => assertConflictResolutionEvidence(forgedDigest), /digests|gate receipt/u);
  const crossPr = structuredClone(state);
  crossPr.conflict_resolution.axes[0].pr_number = 9999;
  assert.throws(() => assertConflictResolutionEvidence(crossPr), /axis evidence/u);
  const unresolved = structuredClone(state);
  unresolved.blockers.push({ reviewer: 'verification', signature: 'pr:merge-conflict', evidence: 'still unresolved', fix_back_eligible: true, status: 'unresolved' });
  assert.throws(() => assertConflictResolutionEvidence(unresolved), /unresolved blocker/u);
});

test('persisted conflict lifecycle reaches terminal evidence on the resolved exact head', () => {
  const repositoryRoot = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-conflict-lifecycle-')));
  const { runtimeRoot, commandRunner } = prepareCanonicalV2Runtime({
    repository_root: repositoryRoot,
    lane_id: 'lane-a',
    issue_numbers: [3305],
  });
  const prUrl = 'https://github.com/fluojs/fluo/pull/3305';
  const receiptBase = (headSha) => ({
    authority: 'issue-supervisor',
    lane_id: 'lane-a',
    issue_number: 3305,
    branch: supervisorIdentity.branch,
    worktree: supervisorIdentity.worktree,
    head_sha: headSha,
    observed_at: '2026-08-26T00:03:00.000Z',
    pr_number: 3305,
    pr_url: prUrl,
  });
  mkdirSync(resolve(repositoryRoot, supervisorIdentity.worktree), { recursive: true });
  const commandOptions = { command_runner: commandRunner };
  const apply = (transition) => {
    if (transition.kind === 'cleanup-observed') {
      rmSync(resolve(repositoryRoot, supervisorIdentity.worktree), { recursive: true, force: true });
      commandRunner.setCleanupCompleted();
    }
    return applyIssueSupervisorTransition(runtimeRoot, 'lane-a', 3305, transition, commandOptions);
  };
  try {
    let bundle = initialiseIssueSupervisorStore(runtimeRoot, {
      ...supervisorIdentity,
      repository_root: repositoryRoot,
      issue_contract_revision: undefined,
      issue_contract_sha256: undefined,
      lane_plan_approval_sha256: undefined,
    }, commandOptions);
    const matrix = createReviewPreflight({
      ...preflight(),
      issue_contract_revision: bundle.snapshot.issue_contract_revision,
      issue_contract_sha256: bundle.snapshot.issue_contract_sha256,
      lane_plan_approval_sha256: bundle.snapshot.lane_plan_approval_sha256,
      approved_sources: bundle.snapshot.preflight_authority.canonical_sources,
      acceptance_row_ids: bundle.snapshot.preflight_authority.canonical_acceptance_ids,
      rows: bundle.snapshot.preflight_authority.canonical_acceptance_ids.map((id, index) => ({
        ...preflight().rows[0],
        id,
        acceptance_text: bundle.snapshot.preflight_authority.canonical_acceptance_criteria[index].content,
        acceptance_sha256: bundle.snapshot.preflight_authority.canonical_acceptance_criteria[index].content_sha256,
        source: bundle.snapshot.preflight_authority.canonical_sources.at(-1).source,
        source_bindings: bundle.snapshot.preflight_authority.canonical_sources,
      })),
    });
    bundle = apply({ kind: 'preflight-completed', preflight: matrix });
    apply(implementationStep(bundle.snapshot, 'b'.repeat(40)));
    const passed = reviews.map((review) => ({
      ...review,
      reviewed_head_sha: 'b'.repeat(40),
      verdict_signal: 'PASS',
      blockers: [],
    }));
    apply({
      kind: 'local-review',
      reviews: passed,
      review_batch: {
        ...reviewBatch(matrix, 'b'.repeat(40), true, repositoryRoot),
        blocker_sources: {},
      },
    });
    apply({
      kind: 'pr-observed',
      action: 'create',
      receipt: {
        ...receiptBase('b'.repeat(40)),
        kind: 'pr-create',
        remote_head_sha: 'b'.repeat(40),
        pr_head_sha: 'b'.repeat(40),
      },
    });
    apply({
      kind: 'pr-conflict-observed',
      receipt: {
        ...receiptBase('b'.repeat(40)),
        kind: 'pr-conflict',
        remote_head_sha: 'b'.repeat(40),
        pr_head_sha: 'b'.repeat(40),
        pr_state: 'OPEN',
        pr_mergeable: 'CONFLICTING',
        pr_merge_state_status: 'DIRTY',
        evidence: 'PR reports merge conflicts.',
      },
    });
    const gate = {
      ...conflictGate(),
      preflight_sha256: matrix.sha256,
    };
    const canonicalEvidence = computeConflictGitEvidence({
      repository_root: repositoryRoot,
      worktree: supervisorIdentity.worktree,
      previously_reviewed_head: gate.previously_reviewed_head,
      upstream_head: gate.upstream_head,
      resolved_head: gate.resolved_head,
      command_runner: commandRunner,
    });
    const { diffs: _diffs, ...machineEvidence } = canonicalEvidence;
    writeConflictTask(
      gate,
      'st_gate_lifecycle',
      {},
      repositoryRoot,
      canonicalEvidence.digests,
      machineEvidence,
    );
    writeActualShapedConflictImplementerTask({
      repository_root: repositoryRoot,
      task_id: 'st_conflict_implementer_lifecycle',
      parent_session_id: supervisorIdentity.parent_session_id,
      lane_id: supervisorIdentity.lane_id,
      issue_number: supervisorIdentity.issue_number,
      worktree: supervisorIdentity.worktree,
      old_base: canonicalEvidence.old_base,
      previously_reviewed_head: gate.previously_reviewed_head,
      upstream_head: gate.upstream_head,
      resolved_head: gate.resolved_head,
      generation: bundle.snapshot.implementer_generation,
      preflight_sha256: matrix.sha256,
    });
    bundle = apply({
      kind: 'conflict-resolved',
      gate,
      gate_task_id: 'st_gate_lifecycle',
      conflict_implementer_task_id: 'st_conflict_implementer_lifecycle',
      rerun_task_ids: {},
    });
    assert.equal(bundle.snapshot.status, 'ready-for-push');
    assert.equal(bundle.snapshot.blockers.length, 0);
    assert.throws(
      () => apply({ kind: 'ci-observed', receipt: { ...receiptBase(gate.resolved_head), kind: 'ci', result: 'pass', evidence: 'premature CI' } }),
      /ready-for-push/u,
    );
    apply({
      kind: 'pr-observed',
      action: 'update',
      receipt: {
        ...receiptBase(gate.resolved_head),
        kind: 'pr-update',
        remote_head_sha: gate.resolved_head,
        pr_head_sha: gate.resolved_head,
      },
    });
    apply({
      kind: 'ci-observed',
      receipt: {
        ...receiptBase(gate.resolved_head),
        kind: 'ci',
        result: 'pass',
        evidence: 'all required checks passed on the resolved head',
      },
    });
    apply({
      kind: 'merge-observed',
      receipt: {
        ...receiptBase(gate.resolved_head),
        kind: 'merge',
        reviewed_head_sha: gate.resolved_head,
        remote_head_sha: gate.resolved_head,
        pr_head_sha: gate.resolved_head,
        ci_head_sha: gate.resolved_head,
        merge_method: 'squash',
        pr_state: 'MERGED',
        issue_state: 'CLOSED',
        merge_commit_sha: 'f'.repeat(40),
      },
    });
    bundle = apply({
      kind: 'cleanup-observed',
      receipt: {
        ...receiptBase(gate.resolved_head),
        kind: 'cleanup',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      },
    });
    assert.equal(bundle.snapshot.status, 'done');
    const loaded = loadIssueSupervisorStore(runtimeRoot, 'lane-a', 3305, commandOptions);
    assert.equal(loaded.snapshot.head_sha, gate.resolved_head);
    assert.equal(loaded.snapshot.ci.head_sha, gate.resolved_head);
    assert.equal(loaded.snapshot.pr.receipt.kind, 'pr-update');
    assert.equal(loaded.snapshot.blockers.length, 0);
    assert.equal(loaded.snapshot.blocker_ledger.length, 1);
    assert.equal(loaded.snapshot.blocker_ledger[0].remediation_status, 'remediated');
    assert.equal(loaded.snapshot.blocker_ledger[0].blocker.signature, 'pr:merge-conflict');
    assert.equal(completedProgress(loaded.snapshot).reviewed_head, gate.resolved_head);

    const snapshotPath = join(runtimeRoot, 'lane-a', 'issues', '3305', 'snapshot.json');
    const original = readFileSync(snapshotPath, 'utf8');
    const sourceTampered = JSON.parse(original);
    sourceTampered.blocker_ledger[0].approved_contract_source = 'forged persisted source';
    writeFileSync(snapshotPath, JSON.stringify(sourceTampered));
    assert.throws(
      () => loadIssueSupervisorStore(runtimeRoot, 'lane-a', 3305, commandOptions),
      /blocker ledger/u,
    );
    writeFileSync(snapshotPath, original);

    const tampered = JSON.parse(original);
    tampered.conflict_resolution.gate_receipt.output_sha256 = '0'.repeat(64);
    writeFileSync(snapshotPath, JSON.stringify(tampered));
    assert.throws(
      () => loadIssueSupervisorStore(runtimeRoot, 'lane-a', 3305, commandOptions),
      /gate receipt|resolved conflict review evidence|local review head/u,
    );
    writeFileSync(snapshotPath, original);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('non-v2 supervisor state is rejected', () => {
  const unsupported = {
    ...createIssueSupervisor(supervisorIdentity),
    version: 3,
  };
  assert.throws(
    () => assertIssueSupervisorState(unsupported),
    /version/u,
  );
});
