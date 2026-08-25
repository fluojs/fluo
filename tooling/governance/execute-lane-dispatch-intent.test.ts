import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PersistedState = Readonly<{
  snapshot: Readonly<Record<string, unknown>>;
  events: readonly Readonly<Record<string, unknown>>[];
  receipts: readonly Readonly<Record<string, unknown>>[];
}>;

const { compileLaneSupervisorDag } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
)) as {
  compileLaneSupervisorDag: (
    snapshot: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
};
const { attachLaneSupervisorRun, reconcileLaneSupervisorDispatch } =
  (await import(
    resolve(
      process.cwd(),
      '.agents/skills/execute-lane/scripts/lane-dispatch.mjs',
    )
  )) as {
    attachLaneSupervisorRun: (input: {
      persisted: PersistedState & { dispatch_event_hash: string };
      runtime_root: string;
      definition: Readonly<Record<string, unknown>>;
      run_id: string;
    }) => Readonly<Record<string, unknown>>;
    reconcileLaneSupervisorDispatch: (input: {
      persisted: PersistedState;
      runtime_root: string;
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

describe('execute-lane lane DAG dispatch intent', () => {
  it('persists one lane intent before the DAG starts', () => {
    // Given
    const persisted = readyState();
    const definition = compileLaneSupervisorDag(persisted.snapshot);
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-intent-'),
    );

    try {
      // When
      const result = reconcileLaneSupervisorDispatch({
        persisted,
        runtime_root: join(directory, 'lane-runs'),
        definition,
      });

      // Then
      expect(result).toMatchObject({ action: 'persist-intent' });
      const prepared = result.persisted as PersistedState & {
        dispatch_event_hash: string;
      };
      expect(prepared.snapshot).toEqual(persisted.snapshot);
      expect(prepared.receipts).toEqual([]);
      expect(prepared.events).toEqual([
        expect.objectContaining({
          event_type: 'lane.dag.dispatch.intent',
          subject_id: 'lane-4101-runtime',
          payload: {
            dag_key: 'fluo:lane:lane-4101-runtime:issue-supervisors:v2',
          },
        }),
      ]);
      expect(prepared.dispatch_event_hash).toBe(
        prepared.events[0]?.event_hash,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on a crash window and attaches one exact lane run', () => {
    // Given
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-dispatch-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    const persisted = readyState();
    const definition = compileLaneSupervisorDag(persisted.snapshot);
    const prepared = reconcileLaneSupervisorDispatch({
      persisted,
      runtime_root: runtimeRoot,
      definition,
    }).persisted as PersistedState & { dispatch_event_hash: string };

    try {
      // When / Then
      expect(
        reconcileLaneSupervisorDispatch({
          persisted: prepared,
          runtime_root: runtimeRoot,
          definition,
        }),
      ).toMatchObject({ action: 'blocked-ledger-conflict' });

      const binding = attachLaneSupervisorRun({
        persisted: prepared,
        runtime_root: runtimeRoot,
        definition,
        run_id: 'run_lane_4101',
      });
      expect(
        reconcileLaneSupervisorDispatch({
          persisted: prepared,
          runtime_root: runtimeRoot,
          definition,
        }),
      ).toMatchObject({
        action: 'attach',
        run_id: 'run_lane_4101',
        binding,
      });
      expect(() =>
        attachLaneSupervisorRun({
          persisted: prepared,
          runtime_root: runtimeRoot,
          definition: { ...definition, name: 'tampered' },
          run_id: 'run_lane_4101',
        }),
      ).toThrow(/definition digest/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
