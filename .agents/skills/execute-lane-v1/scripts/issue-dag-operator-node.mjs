import {
  operatorNodePrompt,
} from './issue-dag-prompts.mjs';

const operatorKinds = new Set([
  'pr-sync',
  'ci-observe',
  'merge',
  'cleanup',
  'release-handoff',
]);

const string = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

const headSha = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new TypeError('operator head must be a canonical digest.');
  }
  return value;
};

const nodeIdFor = (phase, head) => {
  const prNumber = phase.pr?.pr_number ?? 'new';
  if (phase.kind === 'pr-sync') {
    return `pr-${phase.operation}-p${String(prNumber)}-h${head}`;
  }
  if (phase.kind === 'ci-observe') {
    if (!Number.isSafeInteger(phase.observation_ordinal) ||
      phase.observation_ordinal < 1 || prNumber === 'new') {
      throw new TypeError('CI observation identity is invalid.');
    }
    return `ci-observe-o${String(phase.observation_ordinal)}-p${String(prNumber)}-h${head}`;
  }
  if (phase.kind === 'merge') {
    if (prNumber === 'new') throw new TypeError('Merge PR identity is missing.');
    return `merge-p${String(prNumber)}-h${head}`;
  }
  if (phase.kind === 'cleanup') {
    return `cleanup-p${String(prNumber)}-m${headSha(phase.merge_head)}`;
  }
  if (phase.kind === 'release-handoff') {
    return `release-handoff-h${head}-a${phase.approval_sha256}`;
  }
  return `${phase.kind}-${head}`;
};

export const operatorDagNode = (
  lane,
  issueNumber,
  dagKey,
  phase,
  dependsOn,
) => {
  if (!operatorKinds.has(phase.kind)) {
    throw new TypeError('Issue DAG operator phase is invalid.');
  }
  const head = headSha(phase.head_sha);
  const id = nodeIdFor(phase, head);
  return {
    id,
    dependsOn,
    load_skills: ['execute-lane'],
    label: `Issue #${String(issueNumber)} ${phase.kind}`,
    description: `Perform the verified ${phase.kind} lifecycle phase.`,
    task_summary: `Issue #${String(issueNumber)} ${phase.kind}`,
    subagent_type: 'fluo-issue-operator',
    prompt: operatorNodePrompt({
      operation: phase.kind,
      repository_root: string(
        phase.repository_root,
        'operator repository root',
      ),
      lane_id: lane.lane_id,
      issue_number: issueNumber,
      dag_key: dagKey,
      node_id: id,
      worktree: string(phase.worktree, 'operator worktree'),
      head_sha: head,
      pr: phase.pr ?? null,
      operation_kind: phase.operation,
      observation_ordinal: phase.observation_ordinal,
      merge_head: phase.merge_head,
      approval_sha256: phase.approval_sha256,
    }),
  };
};
