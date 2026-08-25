import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PersistedState = Readonly<{
  snapshot: Readonly<Record<string, unknown>>;
  events: readonly Readonly<Record<string, unknown>>[];
  receipts: readonly Readonly<Record<string, unknown>>[];
}>;

const { prepareIssueSupervisorDispatch } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dependency-gate.mjs',
  )
)) as {
  prepareIssueSupervisorDispatch: (
    persisted: PersistedState,
    issueNumber: number,
  ) => PersistedState & { dispatch_event_hash: string };
};
const { compileIssueSupervisorDag } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
)) as {
  compileIssueSupervisorDag: (
    snapshot: Readonly<Record<string, unknown>>,
    issueNumber: number,
  ) => Readonly<Record<string, unknown>>;
};
const { attachIssueSupervisorRun, reconcileIssueSupervisorDispatch } =
  (await import(
    resolve(
      process.cwd(),
      '.agents/skills/execute-lane/scripts/issue-dispatch.mjs',
    )
  )) as {
    attachIssueSupervisorRun: (input: {
      persisted: PersistedState & { dispatch_event_hash: string };
      runtime_root: string;
      issue_number: number;
      definition: Readonly<Record<string, unknown>>;
      run_id: string;
    }) => Readonly<Record<string, unknown>>;
    reconcileIssueSupervisorDispatch: (input: {
      persisted: PersistedState;
      runtime_root: string;
      issue_number: number;
      definition: Readonly<Record<string, unknown>>;
    }) => Readonly<Record<string, unknown>>;
  };

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readyState = (): PersistedState => {
  const parsed: unknown = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-two-lanes-v2.json',
      ),
      'utf8',
    ),
  );
  if (!isRecord(parsed)) {
    throw new TypeError('Ready lane fixture must be an object.');
  }
  return {
    snapshot: {
      ...parsed,
      dependency_graph: {
        '4101': [],
        '4102': [4101],
      },
    },
    events: [],
    receipts: [],
  };
};

describe('execute-lane issue dispatch intent', () => {
  it('persists intent before an eligible issue supervisor starts', () => {
    // Given
    const persisted = readyState();

    // When
    const prepared = prepareIssueSupervisorDispatch(persisted, 4101);

    // Then
    expect(prepared.snapshot).toEqual(persisted.snapshot);
    expect(prepared.receipts).toEqual([]);
    expect(prepared.events).toEqual([
      expect.objectContaining({
        event_type: 'supervisor.dispatch.intent',
        subject_id: '4101',
        payload: { dependencies: [] },
      }),
    ]);
    expect(prepared.dispatch_event_hash).toBe(
      prepared.events[0]?.event_hash,
    );
  });

  it('rejects unmet dependencies and duplicate dispatch intent', () => {
    // Given
    const persisted = readyState();
    const prepared = prepareIssueSupervisorDispatch(persisted, 4101);

    // When / Then
    expect(() =>
      prepareIssueSupervisorDispatch(persisted, 4102),
    ).toThrow(/dependency gate/u);
    expect(() =>
      prepareIssueSupervisorDispatch(prepared, 4101),
    ).toThrow(/dispatch intent already exists/u);
  });

  it('fails closed on an unbound intent and attaches one exact run', () => {
    // Given
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-issue-dispatch-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    const persisted = readyState();
    const definition = compileIssueSupervisorDag(persisted.snapshot, 4101);
    const prepared = prepareIssueSupervisorDispatch(persisted, 4101);

    try {
      // When / Then
      expect(
        reconcileIssueSupervisorDispatch({
          persisted: prepared,
          runtime_root: runtimeRoot,
          issue_number: 4101,
          definition,
        }),
      ).toMatchObject({ action: 'blocked-ledger-conflict' });

      const binding = attachIssueSupervisorRun({
        persisted: prepared,
        runtime_root: runtimeRoot,
        issue_number: 4101,
        definition,
        run_id: 'run_issue_4101',
      });
      expect(
        reconcileIssueSupervisorDispatch({
          persisted: prepared,
          runtime_root: runtimeRoot,
          issue_number: 4101,
          definition,
        }),
      ).toMatchObject({
        action: 'attach',
        run_id: 'run_issue_4101',
        binding,
      });
      expect(() =>
        attachIssueSupervisorRun({
          persisted: prepared,
          runtime_root: runtimeRoot,
          issue_number: 4101,
          definition: { ...definition, name: 'tampered' },
          run_id: 'run_issue_4101',
        }),
      ).toThrow(/definition digest/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
