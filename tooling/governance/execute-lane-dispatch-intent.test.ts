import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
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
const { canonicalLaneLedgerPath } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-runtime-paths.mjs',
  )
)) as {
  canonicalLaneLedgerPath: (
    repositoryRoot: string,
    ledgerPath: string,
  ) => Readonly<{
    laneId: string;
    ledgerPath: string;
    repositoryRoot: string;
  }>;
};
const {
  attachLaneSupervisorRun,
  awaitLaneSupervisorDispatch,
  reconcileLaneSupervisorDispatch,
} =
  (await import(
    resolve(
      process.cwd(),
      '.agents/skills/execute-lane/scripts/lane-dispatch.mjs',
    )
  )) as {
    attachLaneSupervisorRun: (input: {
      persisted: PersistedState & { dispatch_event_hash: string };
      repository_root: string;
      definition: Readonly<Record<string, unknown>>;
      run_id: string;
    }) => Readonly<Record<string, unknown>>;
    awaitLaneSupervisorDispatch: (input: {
      persisted: PersistedState;
      repository_root: string;
      definition: Readonly<Record<string, unknown>>;
      timeout_ms?: number;
    }) => Promise<Readonly<Record<string, unknown>>>;
    reconcileLaneSupervisorDispatch: (input: {
      persisted: PersistedState;
      repository_root: string;
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
  it('accepts only exact canonical lane ledger paths', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-ledger-path-'),
    );
    const outsideLedger = resolve(
      process.cwd(),
      'tooling/governance/fixtures/execute-lane-native/ready-ledger-two-lanes-v2.json',
    );

    try {
      expect(() =>
        canonicalLaneLedgerPath(directory, outsideLedger),
      ).toThrow(/canonical lane ledger path/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
        repository_root: directory,
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
            definition_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
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
    const persisted = readyState();
    const definition = compileLaneSupervisorDag(persisted.snapshot);
    const prepared = reconcileLaneSupervisorDispatch({
      persisted,
      repository_root: directory,
      definition,
    }).persisted as PersistedState & { dispatch_event_hash: string };

    try {
      // When / Then
      expect(
        reconcileLaneSupervisorDispatch({
          persisted: prepared,
          repository_root: directory,
          definition,
        }),
      ).toMatchObject({ action: 'blocked-ledger-conflict' });
      expect(() =>
        attachLaneSupervisorRun({
          persisted: prepared,
          repository_root: directory,
          definition: { ...definition, name: 'definition drifted' },
          run_id: 'run_lane_4101',
        }),
      ).toThrow(/dispatch definition digest/u);

      const binding = attachLaneSupervisorRun({
        persisted: prepared,
        repository_root: directory,
        definition,
        run_id: 'run_lane_4101',
      });
      expect(
        existsSync(
          join(
            directory,
            '.omo',
            'lane-runs',
            'lane-4101-runtime',
            'dag-binding.json',
          ),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(directory, 'lane-4101-runtime', 'dag-binding.json'),
        ),
      ).toBe(false);
      expect(
        reconcileLaneSupervisorDispatch({
          persisted: prepared,
          repository_root: directory,
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
          repository_root: directory,
          definition: { ...definition, name: 'tampered' },
          run_id: 'run_lane_4101',
        }),
      ).toThrow(/definition digest/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('waits for the exact canonical binding before supervisor startup', async () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-startup-gate-'),
    );
    const persisted = readyState();
    const definition = compileLaneSupervisorDag(persisted.snapshot);
    const prepared = reconcileLaneSupervisorDispatch({
      persisted,
      repository_root: directory,
      definition,
    }).persisted as PersistedState & { dispatch_event_hash: string };

    try {
      const waiting = awaitLaneSupervisorDispatch({
        persisted: prepared,
        repository_root: directory,
        definition,
        timeout_ms: 1_000,
      });
      setImmediate(() => {
        attachLaneSupervisorRun({
          persisted: prepared,
          repository_root: directory,
          definition,
          run_id: 'run_lane_4101',
        });
      });

      await expect(waiting).resolves.toMatchObject({
        action: 'attach',
        run_id: 'run_lane_4101',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
