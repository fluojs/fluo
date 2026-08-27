import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { compileIssueLifecycleDag } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
);
const { loadIssueNativeDagRun } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/native-dag-run.mjs',
  )
);

const fixture = () =>
  JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-v2.json',
      ),
      'utf8',
    ),
  ) as Readonly<Record<string, unknown>>;

type DagDefinition = Readonly<{
  key: string;
  name: string;
  nodes: readonly Readonly<Record<string, unknown>>[];
}>;

const persistRun = (
  root: string,
  definition: DagDefinition,
  runtimeGeneration = 1,
  duplicateTaskAttachment = false,
  amendedDefinition?: DagDefinition,
) => {
  const runId = 'dag_issue-4101';
  const parentSessionId = 'ses_issue_dag_parent';
  const createdFingerprint = 'a'.repeat(64);
  const definitionFingerprint = amendedDefinition
    ? 'd'.repeat(64)
    : createdFingerprint;
  const currentDefinition = amendedDefinition ?? definition;
  const runDirectory = resolve(
    root,
    '.omo',
    'senpi-task',
    'dag',
    'runs',
  );
  const keyDirectory = resolve(
    root,
    '.omo',
    'senpi-task',
    'dag',
    'keys',
  );
  const eventDirectory = resolve(
    root,
    '.omo',
    'senpi-task',
    'dag',
    'events',
  );
  mkdirSync(runDirectory, { recursive: true });
  mkdirSync(keyDirectory, { recursive: true });
  mkdirSync(eventDirectory, { recursive: true });
  writeFileSync(
    resolve(runDirectory, `${runId}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      runKey: definition.key,
      parentSessionId,
      name: currentDefinition.name,
      status: 'completed',
      generation: runtimeGeneration,
      definitionFingerprint,
      definition: currentDefinition,
      nodes: {
        preflight: {
          id: `preflight-g0-h${'0'.repeat(40)}`,
          state: 'completed',
          taskId: 'st_preflight',
        },
      },
    })}\n`,
  );
  writeFileSync(
    resolve(eventDirectory, `${runId}.jsonl`),
    `${[
      {
        type: 'dag.run.created',
        runKey: definition.key,
        name: definition.name,
        definitionFingerprint: createdFingerprint,
        nodeCount: definition.nodes.length,
        edgeCount: 0,
        schemaVersion: 1,
        runId,
        seq: 1,
        at: '2026-08-27T00:00:00.000Z',
        lane: 'boundary',
      },
      {
        type: 'dag.run.started',
        generation: 1,
        schemaVersion: 1,
        runId,
        seq: 2,
        at: '2026-08-27T00:00:00.001Z',
        lane: 'boundary',
      },
      ...(amendedDefinition
        ? [
            {
              type: 'dag.definition.amended',
              previousFingerprint: createdFingerprint,
              fingerprint: definitionFingerprint,
              addedNodeIds: [
                amendedDefinition.nodes.at(-1)?.id,
              ],
              changedNodeIds: [],
              invalidatedNodeIds: [],
              definition: amendedDefinition,
              schemaVersion: 1,
              runId,
              seq: 3,
              at: '2026-08-27T00:00:00.002Z',
              lane: 'boundary',
            },
          ]
        : runtimeGeneration === 1
        ? []
        : [
            {
              type: 'dag.node.retried',
              nodeId: definition.nodes[0]?.id,
              generation: runtimeGeneration,
              schemaVersion: 1,
              runId,
              seq: 3,
              at: '2026-08-27T00:00:00.002Z',
              lane: 'boundary',
            },
          ]),
      ...(duplicateTaskAttachment
        ? [
            {
              type: 'dag.node.task-attached',
              nodeId: definition.nodes[0]?.id,
              taskId: 'st_preflight_first',
              attempt: 1,
              schemaVersion: 1,
              runId,
              seq: 3,
              at: '2026-08-27T00:00:00.003Z',
              lane: 'boundary',
            },
            {
              type: 'dag.node.task-attached',
              nodeId: definition.nodes[0]?.id,
              taskId: 'st_preflight_second',
              attempt: 2,
              schemaVersion: 1,
              runId,
              seq: 4,
              at: '2026-08-27T00:00:00.004Z',
              lane: 'boundary',
            },
          ]
        : []),
    ].map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  const keyId = createHash('sha256')
    .update(`${parentSessionId}\0${String(definition.key)}`)
    .digest('hex');
  writeFileSync(
    resolve(keyDirectory, `${keyId}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      runKey: definition.key,
      parentSessionId,
      definitionFingerprint,
    })}\n`,
  );
  return { runId, parentSessionId, definitionFingerprint };
};

describe('execute-lane native issue DAG run', () => {
  it('authenticates one issue run and its key record', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-native-issue-run-')),
    );
    const definition = compileIssueLifecycleDag(fixture(), 4101, {
      bootstrap: {
        repository_root: root,
        starting_head_sha: '0'.repeat(40),
        issue_contract_sha256: 'b'.repeat(64),
        lane_plan_approval_sha256: 'c'.repeat(64),
        evidence_paths: ['docs/contracts/testing-guide.md'],
      },
    });
    const evidence = persistRun(root, definition);
    try {
      expect(
        loadIssueNativeDagRun({
          repository_root: root,
          lane_id: 'lane-4101-runtime',
          issue_number: 4101,
          run_id: evidence.runId,
          coordinator_session_id: evidence.parentSessionId,
        }),
      ).toEqual(
        expect.objectContaining({
          run_id: evidence.runId,
          run_key: definition.key,
          parent_session_id: evidence.parentSessionId,
          status: 'completed',
          native_generation: 1,
          definition_fingerprint: evidence.definitionFingerprint,
          completed_node_ids: [`preflight-g0-h${'0'.repeat(40)}`],
          definition,
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a run substituted under another issue identity', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-native-issue-run-')),
    );
    const definition = compileIssueLifecycleDag(fixture(), 4101, {
      bootstrap: {
        repository_root: root,
        starting_head_sha: '0'.repeat(40),
        issue_contract_sha256: 'b'.repeat(64),
        lane_plan_approval_sha256: 'c'.repeat(64),
        evidence_paths: ['docs/contracts/testing-guide.md'],
      },
    });
    const evidence = persistRun(root, definition);
    try {
      expect(() =>
        loadIssueNativeDagRun({
          repository_root: root,
          lane_id: 'lane-4101-runtime',
          issue_number: 4102,
          run_id: evidence.runId,
          coordinator_session_id: evidence.parentSessionId,
        }),
      ).toThrow(/does not match/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects mutable native retries of an issue DAG node', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-native-issue-run-')),
    );
    const definition = compileIssueLifecycleDag(fixture(), 4101, {
      bootstrap: {
        repository_root: root,
        starting_head_sha: '0'.repeat(40),
        issue_contract_sha256: 'b'.repeat(64),
        lane_plan_approval_sha256: 'c'.repeat(64),
        evidence_paths: ['docs/contracts/testing-guide.md'],
      },
    });
    const evidence = persistRun(root, definition, 3);
    try {
      expect(() =>
        loadIssueNativeDagRun({
          repository_root: root,
          lane_id: 'lane-4101-runtime',
          issue_number: 4101,
          run_id: evidence.runId,
          coordinator_session_id: evidence.parentSessionId,
        }),
      ).toThrow(/retry|immutable/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a native amendment without treating it as a node retry', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-native-issue-run-')),
    );
    const definition = compileIssueLifecycleDag(fixture(), 4101, {
      bootstrap: {
        repository_root: root,
        starting_head_sha: '0'.repeat(40),
        issue_contract_sha256: 'b'.repeat(64),
        lane_plan_approval_sha256: 'c'.repeat(64),
        evidence_paths: ['docs/contracts/testing-guide.md'],
      },
    });
    const addedNode = {
      ...definition.nodes[0],
      id: `preflight-g1-h${'1'.repeat(40)}`,
      label: 'Fresh preflight',
      description: 'Fresh preflight amendment',
      task_summary: 'Fresh preflight amendment',
      dependsOn: [],
    };
    const amendedDefinition = {
      ...definition,
      nodes: [...definition.nodes, addedNode],
    };
    const evidence = persistRun(
      root,
      definition,
      2,
      false,
      amendedDefinition,
    );
    try {
      expect(
        loadIssueNativeDagRun({
          repository_root: root,
          lane_id: 'lane-4101-runtime',
          issue_number: 4101,
          run_id: evidence.runId,
          coordinator_session_id: evidence.parentSessionId,
        }),
      ).toEqual(
        expect.objectContaining({
          native_generation: 2,
          definition: amendedDefinition,
          amendments: [
            expect.objectContaining({
              previous_fingerprint: 'a'.repeat(64),
              fingerprint: 'd'.repeat(64),
              added_node_ids: [addedNode.id],
            }),
          ],
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects multiple task attachments for one immutable node', () => {
    const root = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), 'fluo-native-issue-run-')),
    );
    const definition = compileIssueLifecycleDag(fixture(), 4101, {
      bootstrap: {
        repository_root: root,
        starting_head_sha: '0'.repeat(40),
        issue_contract_sha256: 'b'.repeat(64),
        lane_plan_approval_sha256: 'c'.repeat(64),
        evidence_paths: ['docs/contracts/testing-guide.md'],
      },
    });
    const evidence = persistRun(root, definition, 1, true);
    try {
      expect(() =>
        loadIssueNativeDagRun({
          repository_root: root,
          lane_id: 'lane-4101-runtime',
          issue_number: 4101,
          run_id: evidence.runId,
          coordinator_session_id: evidence.parentSessionId,
        }),
      ).toThrow(/attachment|immutable/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
