import {
  terminalTaskPrompt,
} from './dispatch-authority.mjs';
import {
  reviewNodePrompt,
} from './issue-dag-prompts.mjs';
import {
  CONFLICT_IMPLEMENTER_FINAL_SENTINEL,
  conflictImplementerPromptSentinel,
} from './implementer-runtime.mjs';
import {
  CONFLICT_REVIEW_FINAL_SENTINEL,
  conflictReviewerTaskPrompt,
} from './reviewer-runtime.mjs';

const reviewerAgents = Object.freeze({
  contract: 'fluo-contract-reviewer',
  code: 'fluo-code-reviewer',
  verification: 'fluo-verification-reviewer',
});

const sha = (value, name) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new TypeError(`${name} must be a canonical head.`);
  }
  return value;
};

const conflictImplementation = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  const previous = sha(
    phase.previously_reviewed_head,
    'conflict reviewed head',
  );
  const upstream = sha(phase.upstream_head, 'conflict upstream head');
  const id =
    `conflict-implement-g${String(phase.generation)}` +
    `-h${previous}-u${upstream}`;
  return {
    id,
    dependsOn,
    load_skills: ['execute-lane', 'programming'],
    label: `Issue #${String(issueNumber)} conflict implementation`,
    description: 'Resolve one exact upstream conflict without delegation.',
    task_summary: `Issue #${String(issueNumber)} conflict 해결`,
    subagent_type: 'fluo-issue-implementer',
    prompt: terminalTaskPrompt({
      instructions: `TASK:
Resolve the bound conflict in the assigned issue worktree.

DELIVERABLE:
Return ${CONFLICT_IMPLEMENTER_FINAL_SENTINEL} with the actual resolved head.

SCOPE:
Mutate only the assigned issue worktree. Do not push, mutate GitHub, review the
result, or dispatch another agent.

VERIFY:
Prove the worktree is based on the bound upstream head and report every
conflicting file and hunk resolved.

STOP WHEN:
A new resolved head is returned, or one terminal conflict blocker is returned.`,
      dispatch_block: conflictImplementerPromptSentinel({
        repository_root: phase.repository_root,
        lane_id: lane.lane_id,
        issue_number: issueNumber,
        worktree: phase.worktree,
        parent_session_id: phase.parent_session_id,
        old_base: phase.old_base,
        previously_reviewed_head: previous,
        upstream_head: upstream,
        generation: phase.generation,
        preflight_sha256: phase.preflight_sha256,
        dag_key: dagKey,
        node_id: id,
      }),
    }),
  };
};

const conflictGate = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  const resolved = sha(phase.resolved_head, 'conflict resolved head');
  const previous = sha(
    phase.previously_reviewed_head,
    'conflict reviewed head',
  );
  const upstream = sha(phase.upstream_head, 'conflict upstream head');
  const id =
    `conflict-gate-g${String(phase.generation)}-h${resolved}` +
    `-from${previous}-u${upstream}`;
  return {
    id,
    dependsOn,
    load_skills: ['execute-lane'],
    label: `Issue #${String(issueNumber)} conflict gate`,
    description: 'Compute exact inherited and rerun review axes.',
    task_summary: `Issue #${String(issueNumber)} conflict gate`,
    subagent_type: 'fluo-contract-reviewer',
    prompt: conflictReviewerTaskPrompt({
      instructions: `TASK:
Audit the exact conflict resolution and determine the minimum safe rerun axes.

DELIVERABLE:
Return ${CONFLICT_REVIEW_FINAL_SENTINEL} with canonical path/diff impact and
affected review axes.

SCOPE:
Remain read-only. Do not mutate Git, GitHub, source, or dispatch agents.

VERIFY:
Require all axes for ambiguous or cross-cutting impact; inherit a prior PASS
only when canonical Git proves patch equivalence and no upstream overlap.

STOP WHEN:
Every inherited and rerun axis is justified by exact Git evidence.`,
      repository_root: phase.repository_root,
      lane_id: lane.lane_id,
      issue_number: issueNumber,
      worktree: phase.worktree,
      preflight_sha256: phase.preflight_sha256,
      previously_reviewed_head: previous,
      upstream_head: upstream,
      resolved_head: resolved,
      generation: phase.generation,
      machine_evidence: phase.machine_evidence,
      dag_key: dagKey,
      node_id: id,
    }),
  };
};

const conflictReview = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  const resolved = sha(phase.resolved_head, 'conflict review head');
  if (
    !Array.isArray(phase.affected_axes) ||
    phase.affected_axes.length === 0 ||
    phase.affected_axes.some((axis) => reviewerAgents[axis] === undefined)
  ) {
    throw new TypeError('Conflict review axes are invalid.');
  }
  return [...new Set(phase.affected_axes)].map((axis) => {
    const id =
      `conflict-review-${axis}-g${String(phase.generation)}-h${resolved}`;
    return {
      id,
      dependsOn,
      load_skills: ['execute-lane'],
      label: `Issue #${String(issueNumber)} conflict ${axis} review`,
      description: `Review resolved conflict on the ${axis} axis.`,
      task_summary: `Issue #${String(issueNumber)} conflict ${axis} review`,
      subagent_type: reviewerAgents[axis],
      prompt: reviewNodePrompt({
        instructions: `TASK:
Review the exact resolved conflict head on the ${axis} axis.

DELIVERABLE:
Return the canonical reviewer final response with complete affected-row coverage.

SCOPE:
Remain source-read-only and do not dispatch agents.

VERIFY:
Close every affected preflight row as PASS or BLOCK.

STOP WHEN:
Every affected row is decided for the exact resolved head.`,
        repository_root: phase.repository_root,
        lane_id: lane.lane_id,
        issue_number: issueNumber,
        worktree: phase.worktree,
        head_sha: resolved,
        preflight_sha256: phase.preflight_sha256,
        review_axis: axis,
        dag_key: dagKey,
        node_id: id,
        ...(axis === 'verification'
          ? {
              canonical_verification_receipt_id:
                phase.verification_receipt_id,
            }
          : {}),
      }),
    };
  });
};

export const conflictDagNodes = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) =>
  phase.kind === 'conflict-implementation'
    ? [
        conflictImplementation(
          lane,
          issueNumber,
          dagKey,
          phase,
          dependsOn,
        ),
      ]
    : phase.kind === 'conflict-gate'
      ? [conflictGate(lane, issueNumber, dagKey, phase, dependsOn)]
      : conflictReview(lane, issueNumber, dagKey, phase, dependsOn);
