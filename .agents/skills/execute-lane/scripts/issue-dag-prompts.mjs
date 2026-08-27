import {
  implementerTaskPrompt,
} from './implementer-runtime.mjs';
import {
  reviewerTaskPrompt,
} from './reviewer-runtime.mjs';
import {
  terminalDispatchBlock,
  terminalTaskPrompt,
} from './dispatch-authority.mjs';

export const PREFLIGHT_SENTINEL =
  'fluo:execute-lane:preflight:dispatch:v3';
export const PREFLIGHT_FINAL_SENTINEL =
  'fluo:execute-lane:preflight:final:v3';
export const OPERATOR_SENTINEL =
  'fluo:execute-lane:operator:dispatch:v3';
export const OPERATOR_FINAL_SENTINEL =
  'fluo:execute-lane:operator:final:v3';

const baseAuthority = ({
  lane_id,
  issue_number,
  dag_key,
  node_id,
}) => ({
  version: 3,
  lane_id,
  issue_number,
  dag_key,
  node_id,
});

export const preflightNodePrompt = (authority) =>
  terminalTaskPrompt({
    instructions: `TASK:
Build the immutable review-preflight v1 acceptance matrix for the bound issue.

DELIVERABLE:
Return exactly one machine envelope with no prose or code fence:
<${PREFLIGHT_FINAL_SENTINEL}>{"sentinel":"${PREFLIGHT_FINAL_SENTINEL}","preflight":{...}}</${PREFLIGHT_FINAL_SENTINEL}>

SCOPE:
- Read the canonical lane ledger, issue store authority, and every parent-bound
  evidence path in the terminal dispatch.
- Only read and task-local todo are available. Do not call bash or eval.
- Copy authority and acceptance digests from the issue store. Return the
  preflight object without sha256; the trusted parent seals its digest.
- Do not mutate source, Git, GitHub, lane state, or issue runtime state.
- Cover every exact live Acceptance Criteria item by ID and digest.

VERIFY:
Every canonical source and acceptance ID is revision/content bound and every
row has positive, negative, boundary, complexity, memory, atomicity, and
mutation-boundary coverage.

STOP WHEN:
The complete machine preflight is returned, or one explicit authority blocker
is returned.`,
    dispatch_block: terminalDispatchBlock({
      ...baseAuthority(authority),
      sentinel: PREFLIGHT_SENTINEL,
      repository_root: authority.repository_root,
      lane_ledger_path: authority.lane_ledger_path,
      issue_store_path: authority.issue_store_path,
      evidence_paths: authority.evidence_paths,
      issue_contract_sha256: authority.issue_contract_sha256,
      lane_plan_approval_sha256: authority.lane_plan_approval_sha256,
      starting_head_sha: authority.starting_head_sha,
      source_read_only: true,
    }),
  });

export const implementationNodePrompt = ({
  instructions,
  ...authority
}) =>
  implementerTaskPrompt({
    instructions,
    ...authority,
  });

export const reviewNodePrompt = ({
  instructions,
  ...authority
}) =>
  reviewerTaskPrompt({
    instructions,
    ...authority,
  });

export const operatorNodePrompt = ({
  operation,
  repository_root,
  lane_id,
  issue_number,
  dag_key,
  node_id,
  worktree,
  head_sha,
  pr,
  operation_kind,
  observation_ordinal,
  merge_head,
  approval_sha256,
}) =>
  terminalTaskPrompt({
    instructions: `TASK:
Perform the bound ${operation} operation for issue ${String(issue_number)}.

DELIVERABLE:
Return ${OPERATOR_FINAL_SENTINEL} with fresh Git/GitHub observations and the
exact resulting head, PR, CI, merge, or cleanup evidence for this operation.

SCOPE:
- Operate only on ${worktree} and the canonical issue branch/PR.
- Use only the authority already granted by the canonical lane.
- Do not dispatch or invoke another agent.

VERIFY:
Re-read live Git and GitHub state after the operation and bind every observation
to ${head_sha}.

STOP WHEN:
The exact operation is observed complete, or one typed external/policy blocker
is returned.`,
    dispatch_block: terminalDispatchBlock({
      ...baseAuthority({ lane_id, issue_number, dag_key, node_id }),
      sentinel: OPERATOR_SENTINEL,
      operation,
      repository_root,
      worktree,
      head_sha,
      pr,
      operation_kind,
      observation_ordinal,
      merge_head,
      approval_sha256,
    }),
  });
