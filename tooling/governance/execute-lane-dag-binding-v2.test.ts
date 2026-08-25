import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type DagDefinition = Readonly<{
  key: string;
  name: string;
  nodes: readonly Readonly<Record<string, unknown>>[];
}>;

type IssueDagBinding = Readonly<{
  version: 2;
  lane_id: string;
  issue_number: number;
  dependencies: readonly number[];
  dag_key: string;
  run_id: string;
  definition_sha256: string;
  dispatch_event_hash: string;
  status: 'attached';
}>;

const {
  assertIssueDagBindingMatches,
  createIssueDagBinding,
  loadIssueDagBinding,
  persistIssueDagBinding,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dag-binding.mjs',
  )
)) as {
  createIssueDagBinding: (input: {
    definition: DagDefinition;
    lane_id: string;
    issue_number: number;
    dependencies: readonly number[];
    run_id: string;
    dispatch_event_hash: string;
  }) => IssueDagBinding;
  persistIssueDagBinding: (
    runtimeRoot: string,
    binding: IssueDagBinding,
  ) => void;
  loadIssueDagBinding: (
    runtimeRoot: string,
    laneId: string,
    issueNumber: number,
  ) => IssueDagBinding | null;
  assertIssueDagBindingMatches: (
    binding: IssueDagBinding,
    expected: {
      definition: DagDefinition;
      lane_id: string;
      issue_number: number;
      dependencies: readonly number[];
      run_id: string;
      dispatch_event_hash: string;
    },
  ) => void;
};

const laneId = 'lane-4101-runtime';
const issueNumber = 4102;
const dispatchEventHash = 'e'.repeat(64);
const definition: DagDefinition = {
  key: `fluo:lane:${laneId}:issue-${String(issueNumber)}:supervisor:v2`,
  name: `Fluo lane ${laneId} issue ${String(issueNumber)} supervisor`,
  nodes: [
    {
      id: `issue-${String(issueNumber)}-supervisor`,
      category: 'deep',
      dependsOn: [],
      load_skills: ['execute-lane'],
      prompt: 'fixture',
    },
  ],
};

describe('execute-lane per-issue DAG binding', () => {
  it('persists one immutable binding for an eligible issue dispatch', () => {
    // Given
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-issue-dag-binding-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    const binding = createIssueDagBinding({
      definition,
      lane_id: laneId,
      issue_number: issueNumber,
      dependencies: [4101],
      run_id: 'run_issue_4102',
      dispatch_event_hash: dispatchEventHash,
    });

    try {
      // When
      persistIssueDagBinding(runtimeRoot, binding);
      persistIssueDagBinding(runtimeRoot, binding);

      // Then
      expect(loadIssueDagBinding(runtimeRoot, laneId, issueNumber)).toEqual(
        binding,
      );
      expect(() =>
        assertIssueDagBindingMatches(binding, {
          definition,
          lane_id: laneId,
          issue_number: issueNumber,
          dependencies: [4101],
          run_id: 'run_issue_4102',
          dispatch_event_hash: dispatchEventHash,
        }),
      ).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a substituted run or definition for the same issue', () => {
    // Given
    const binding = createIssueDagBinding({
      definition,
      lane_id: laneId,
      issue_number: issueNumber,
      dependencies: [4101],
      run_id: 'run_issue_4102',
      dispatch_event_hash: dispatchEventHash,
    });

    // When / Then
    expect(() =>
      assertIssueDagBindingMatches(binding, {
        definition,
        lane_id: laneId,
        issue_number: issueNumber,
        dependencies: [4101],
        run_id: 'run_substituted',
        dispatch_event_hash: dispatchEventHash,
      }),
    ).toThrow(/identity/u);
    expect(() =>
      assertIssueDagBindingMatches(binding, {
        definition: { ...definition, name: 'tampered definition' },
        lane_id: laneId,
        issue_number: issueNumber,
        dependencies: [4101],
        run_id: 'run_issue_4102',
        dispatch_event_hash: dispatchEventHash,
      }),
    ).toThrow(/definition digest/u);
  });
});
