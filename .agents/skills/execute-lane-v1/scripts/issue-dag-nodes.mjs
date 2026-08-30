import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  implementerRoute,
} from './implementer-runtime.mjs';
import {
  implementationNodePrompt,
  preflightNodePrompt,
  reviewNodePrompt,
} from './issue-dag-prompts.mjs';
import {
  operatorDagNode,
} from './issue-dag-operator-node.mjs';
import {
  conflictDagNodes,
} from './issue-dag-conflict-nodes.mjs';

const axes = Object.freeze(['contract', 'code', 'verification']);
const reviewerAgents = Object.freeze({
  contract: 'fluo-contract-reviewer',
  code: 'fluo-code-reviewer',
  verification: 'fluo-verification-reviewer',
});

export {
  implementerRoute,
};

const sha = (value, name, length) => {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^[a-f0-9]{${String(length)}}$`, 'u').test(value)
  ) {
    throw new TypeError(`${name} must be a canonical digest.`);
  }
  return value;
};

const string = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

const base = (id, dependsOn) => ({
  id,
  dependsOn,
  load_skills: ['execute-lane'],
});

const preflightNode = (
  lane,
  issueNumber,
  dagKey,
  bootstrap,
  retryGeneration,
  dependsOn,
) => {
  const head = sha(bootstrap.starting_head_sha, 'preflight head', 40);
  const evidencePaths = bootstrap.evidence_paths;
  if (
    !Array.isArray(evidencePaths) ||
    evidencePaths.length === 0 ||
    new Set(evidencePaths).size !== evidencePaths.length ||
    evidencePaths.some(
      (path) =>
        typeof path !== 'string' ||
        path.length === 0 ||
        path.startsWith('/') ||
        /(?:^|\/)\.\.(?:\/|$)/u.test(path),
    )
  ) {
    throw new TypeError(
      'preflight evidence paths must be unique repository-relative paths.',
    );
  }
  if (
    !Number.isSafeInteger(retryGeneration) ||
    retryGeneration < 0
  ) {
    throw new TypeError('preflight retry generation must be a safe integer.');
  }
  const id = `preflight-g${String(retryGeneration)}-h${head}`;
  return {
  ...base(id, dependsOn),
  label:
    `Issue #${String(issueNumber)} preflight g${String(retryGeneration)}`,
  description: 'Compile immutable issue acceptance authority.',
  task_summary:
    `Issue #${String(issueNumber)} preflight g${String(retryGeneration)} 작성`,
  subagent_type: 'fluo-issue-preflight',
  prompt: preflightNodePrompt({
    repository_root: string(
      bootstrap.repository_root,
      'preflight repository root',
    ),
    lane_id: lane.lane_id,
    issue_number: issueNumber,
    dag_key: dagKey,
    node_id: id,
    lane_ledger_path: `.omo/lanes/${lane.lane_id}.json`,
    issue_store_path:
      `.omo/lane-runs/${lane.lane_id}/issues/${String(issueNumber)}/snapshot.json`,
    starting_head_sha: head,
    issue_contract_sha256: sha(
      bootstrap.issue_contract_sha256,
      'preflight issue contract',
      64,
    ),
    lane_plan_approval_sha256: sha(
      bootstrap.lane_plan_approval_sha256,
      'preflight lane approval',
      64,
    ),
    evidence_paths: evidencePaths.map((path) =>
      string(path, 'preflight evidence path'),
    ),
  }),
  };
};

export const preflightDagNode = (
  lane,
  issueNumber,
  dagKey,
  bootstrap,
) =>
  preflightNode(
    lane,
    issueNumber,
    dagKey,
    bootstrap,
    0,
    [],
  );

const preflightRetryDagNode = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  if (
    !Number.isSafeInteger(phase.retry_generation) ||
    phase.retry_generation < 1
  ) {
    throw new TypeError('Preflight retry phase authority is invalid.');
  }
  return preflightNode(
    lane,
    issueNumber,
    dagKey,
    phase,
    phase.retry_generation,
    dependsOn,
  );
};

const implementationInstructions = `TASK:
Implement the bound Fluo issue generation test-first in its isolated worktree.

DELIVERABLE:
Follow the exact implementer final envelope schema appended to this prompt and
return a new verified head.

SCOPE:
Read .agents/skills/issue-to-pr/references/implementer.md and edit only the
assigned issue worktree. Do not push, mutate a PR, or dispatch agents.

VERIFY:
Run focused tests and changed-file checks only.

STOP WHEN:
The bound blockers are addressed on a new head, or one terminal child-contract
blocker is returned.`;

const implementationNode = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  const head = sha(phase.head_sha, 'implementation head', 40);
  const id = `implement-g${String(phase.generation)}-${head}`;
  if (
    !Number.isSafeInteger(phase.generation) ||
    phase.generation < 1 ||
    !Array.isArray(phase.blocker_ledger) ||
    !Array.isArray(phase.unresolved_blockers) ||
    payloadDigest(phase.blocker_ledger) !== phase.blocker_ledger_sha256
  ) {
    throw new TypeError('Implementation phase authority is invalid.');
  }
  return {
    ...base(id, dependsOn),
    label: `Issue #${String(issueNumber)} implementation g${String(phase.generation)}`,
    description: 'Implement one verified issue generation.',
    task_summary: `Issue #${String(issueNumber)} generation 구현`,
    subagent_type: implementerRoute.subagent_type,
    prompt: implementationNodePrompt({
      instructions: implementationInstructions,
      repository_root: string(
        phase.repository_root,
        'implementation repository root',
      ),
      lane_id: lane.lane_id,
      issue_number: issueNumber,
      worktree: string(phase.worktree, 'implementation worktree'),
      current_head: head,
      parent_session_id: string(
        phase.parent_session_id,
        'implementation coordinator session',
      ),
      generation: phase.generation,
      blocker_ledger: phase.blocker_ledger,
      unresolved_blockers: phase.unresolved_blockers,
      blocker_ledger_sha256: sha(
        phase.blocker_ledger_sha256,
        'blocker ledger',
        64,
      ),
      preflight_sha256: sha(
        phase.preflight_sha256,
        'implementation preflight',
        64,
      ),
      dag_key: dagKey,
      node_id: id,
    }),
  };
};

const reviewInstructions = (axis) => `TASK:
Review the exact bound head on the ${axis} axis.

DELIVERABLE:
Return the existing ${axis} reviewer final response with complete row coverage.

SCOPE:
Remain source-read-only. Do not call bash or eval. On the verification axis,
read and authenticate the parent-owned canonical verification receipt from the
terminal dispatch. Do not dispatch agents.

VERIFY:
Report every currently discoverable blocker and close every preflight row.

STOP WHEN:
Every row is PASS or BLOCK for the exact head.`;

const reviewNodes = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  const head = sha(phase.head_sha, 'review head', 40);
  const revalidationSuffix =
    phase.review_revalidation_generation === undefined
      ? ''
      : (
          Number.isSafeInteger(phase.review_revalidation_generation) &&
          phase.review_revalidation_generation > 0
            ? `-revalidation-g${String(phase.review_revalidation_generation)}`
            : (() => {
                throw new TypeError(
                  'Review revalidation generation is invalid.',
                );
              })()
        );
  return axes.map((axis) => {
    const id = `review-${axis}${revalidationSuffix}-${head}`;
    return {
      ...base(id, dependsOn),
      label: `Issue #${String(issueNumber)} ${axis} review`,
      description: `Review exact issue head on the ${axis} axis.`,
      task_summary: `Issue #${String(issueNumber)} ${axis} review`,
      subagent_type: reviewerAgents[axis],
      prompt: reviewNodePrompt({
        instructions: reviewInstructions(axis),
        repository_root: string(
          phase.repository_root,
          'review repository root',
        ),
        lane_id: lane.lane_id,
        issue_number: issueNumber,
        worktree: string(phase.worktree, 'review worktree'),
        head_sha: head,
        preflight_sha256: sha(
          phase.preflight_sha256,
          'review preflight',
          64,
        ),
        review_axis: axis,
        ...(axis === 'verification'
          ? {
              canonical_verification_receipt_id: string(
                phase.verification_receipt_id,
                'parent-owned verification receipt identity',
              ),
            }
          : {}),
        dag_key: dagKey,
        node_id: id,
      }),
    };
  });
};

const reviewRetryNode = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  const head = sha(phase.head_sha, 'review retry head', 40);
  const axis = phase.review_axis;
  if (
    !axes.includes(axis) ||
    !Number.isSafeInteger(phase.retry_generation) ||
    phase.retry_generation < 1
  ) {
    throw new TypeError('Review retry phase authority is invalid.');
  }
  const id =
    `review-${axis}-retry-g${String(phase.retry_generation)}-${head}`;
  return {
    ...base(id, dependsOn),
    label:
      `Issue #${String(issueNumber)} ${axis} review retry g${String(phase.retry_generation)}`,
    description: `Retry exact issue head review on the ${axis} axis.`,
    task_summary:
      `Issue #${String(issueNumber)} ${axis} review retry`,
    subagent_type: reviewerAgents[axis],
    prompt: reviewNodePrompt({
      instructions: reviewInstructions(axis),
      repository_root: string(
        phase.repository_root,
        'review retry repository root',
      ),
      lane_id: lane.lane_id,
      issue_number: issueNumber,
      worktree: string(phase.worktree, 'review retry worktree'),
      head_sha: head,
      preflight_sha256: sha(
        phase.preflight_sha256,
        'review retry preflight',
        64,
      ),
      review_axis: axis,
      ...(axis === 'verification'
        ? {
            canonical_verification_receipt_id: string(
              phase.verification_receipt_id,
              'parent-owned verification retry receipt identity',
            ),
          }
        : {}),
      dag_key: dagKey,
      node_id: id,
    }),
  };
};

export const phaseDagNodes = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) =>
  phase.kind.startsWith('conflict-')
    ? conflictDagNodes(lane, issueNumber, dagKey, phase, dependsOn)
    : phase.kind === 'preflight-retry'
      ? [
          preflightRetryDagNode(
            lane,
            issueNumber,
            dagKey,
            phase,
            dependsOn,
          ),
        ]
    : phase.kind === 'implementation'
    ? [
        implementationNode(
          lane,
          issueNumber,
          dagKey,
          phase,
          dependsOn,
        ),
      ]
    : phase.kind === 'review'
      ? reviewNodes(lane, issueNumber, dagKey, phase, dependsOn)
      : phase.kind === 'review-retry'
        ? [
            reviewRetryNode(
              lane,
              issueNumber,
              dagKey,
              phase,
              dependsOn,
            ),
          ]
      : [operatorDagNode(lane, issueNumber, dagKey, phase, dependsOn)];
