import { createHash } from 'node:crypto';
import {
  existsSync,
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

type PersistedState = Readonly<{
  snapshot: Readonly<Record<string, unknown>>;
  events: readonly Readonly<Record<string, unknown>>[];
  receipts: readonly Readonly<Record<string, unknown>>[];
}>;

const { hashEvent, payloadDigest } = (await import(
  resolve(
    process.cwd(),
    '.agents/workflow-contracts/contracts.mjs',
  )
)) as {
  hashEvent: (
    event: Readonly<Record<string, unknown>>,
  ) => string;
  payloadDigest: (value: unknown) => string;
};
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
const { createDagBinding, persistDagBinding } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dag-binding.mjs',
  )
)) as {
  createDagBinding: (
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
  persistDagBinding: (
    runtimeRoot: string,
    binding: Readonly<Record<string, unknown>>,
  ) => void;
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
      run_id: string;
    }) => Readonly<Record<string, unknown>>;
    awaitLaneSupervisorDispatch: (input: {
      persisted: PersistedState;
      repository_root: string;
      timeout_ms?: number;
    }) => Promise<Readonly<Record<string, unknown>>>;
    reconcileLaneSupervisorDispatch: (input: {
      persisted: PersistedState;
      repository_root: string;
      definition?: Readonly<Record<string, unknown>>;
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

const persistNativeDagRun = (
  repositoryRoot: string,
  runId: string,
  definition: Readonly<Record<string, unknown>>,
  writeKey = true,
) => {
  const runDirectory = resolve(
    repositoryRoot,
    '.omo',
    'senpi-task',
    'dag',
    'runs',
  );
  mkdirSync(runDirectory, { recursive: true });
  if (!Array.isArray(definition.nodes)) {
    throw new TypeError('Test DAG definition nodes must be an array.');
  }
  const nodes = definition.nodes.map((node) => {
    if (!isRecord(node)) {
      throw new TypeError('Test DAG node must be an object.');
    }
    return {
      id: node.id,
      prompt: node.prompt,
      label: node.label,
      dependsOn: node.dependsOn,
      task_summary: node.task_summary,
      description: node.description,
      load_skills: node.load_skills,
      category: node.category,
      subagent_type: node.subagent_type,
      effectivePrompt: `loaded:${String(node.prompt)}`,
    };
  });
  const parentSessionId = createHash('sha256')
    .update(runId)
    .digest('hex')
    .slice(0, 36);
  const definitionFingerprint = 'a'.repeat(64);
  writeFileSync(
    resolve(runDirectory, `${runId}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      parentSessionId,
      runId,
      runKey: definition.key,
      name: definition.name,
      status: 'running',
      definitionFingerprint,
      definition: {
        key: definition.key,
        name: definition.name,
        nodes,
      },
      nodes: [],
    })}\n`,
  );
  if (writeKey) {
    const keyId = createHash('sha256')
      .update(`${parentSessionId}\0${String(definition.key)}`)
      .digest('hex');
    const keyDirectory = resolve(
      repositoryRoot,
      '.omo',
      'senpi-task',
      'dag',
      'keys',
    );
    mkdirSync(keyDirectory, { recursive: true });
    writeFileSync(
      resolve(keyDirectory, `${keyId}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        parentSessionId,
        runKey: definition.key,
        runId,
        definitionFingerprint,
      })}\n`,
    );
  }
};

const withoutDefinitionDigest = (
  persisted: PersistedState & { dispatch_event_hash: string },
) => {
  const [event] = persisted.events;
  if (!isRecord(event) || !isRecord(event.payload)) {
    throw new TypeError('Dispatch event fixture must exist.');
  }
  const payload = { dag_key: event.payload.dag_key };
  const draft = {
    ...event,
    payload,
    payload_sha256: payloadDigest(payload),
  };
  const legacyEvent = { ...draft, event_hash: hashEvent(draft) };
  return {
    ...persisted,
    events: [legacyEvent],
    dispatch_event_hash: legacyEvent.event_hash,
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
          run_id: 'dag_missing',
        }),
      ).toThrow(/native DAG run/u);

      persistNativeDagRun(
        directory,
        'dag_forged',
        definition,
        false,
      );
      expect(() =>
        attachLaneSupervisorRun({
          persisted: prepared,
          repository_root: directory,
          run_id: 'dag_forged',
        }),
      ).toThrow(/native DAG key record/u);

      persistNativeDagRun(directory, 'dag_4101', definition);
      const binding = attachLaneSupervisorRun({
        persisted: prepared,
        repository_root: directory,
        run_id: 'dag_4101',
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
        run_id: 'dag_4101',
        binding,
      });
      expect(
        reconcileLaneSupervisorDispatch({
          persisted: prepared,
          repository_root: directory,
          definition: { ...definition, name: 'tampered' },
        }),
      ).toMatchObject({
        action: 'attach',
        run_id: 'dag_4101',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects legacy intent rebinding and a mismatched native run', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-lane-native-binding-'),
    );
    const persisted = readyState();
    const definition = compileLaneSupervisorDag(persisted.snapshot);
    const prepared = reconcileLaneSupervisorDispatch({
      persisted,
      repository_root: directory,
      definition,
    }).persisted as PersistedState & { dispatch_event_hash: string };

    try {
      const legacy = withoutDefinitionDigest(prepared);
      persistNativeDagRun(directory, 'dag_legacy', definition);
      expect(() =>
        attachLaneSupervisorRun({
          persisted: legacy,
          repository_root: directory,
          run_id: 'dag_legacy',
        }),
      ).toThrow(/legacy dispatch intent.*successor lane/u);

      persistNativeDagRun(directory, 'dag_mismatch', {
        ...definition,
        name: 'different native definition',
      });
      expect(() =>
        attachLaneSupervisorRun({
          persisted: prepared,
          repository_root: directory,
          run_id: 'dag_mismatch',
        }),
      ).toThrow(/native DAG definition digest/u);

      const binding = createDagBinding({
        definition,
        lane_id: 'lane-4101-runtime',
        run_id: 'dag_legacy',
        dispatch_event_hash: legacy.dispatch_event_hash,
      });
      persistDagBinding(
        resolve(directory, '.omo', 'lane-runs'),
        binding,
      );
      expect(
        reconcileLaneSupervisorDispatch({
          persisted: legacy,
          repository_root: directory,
        }),
      ).toMatchObject({
        action: 'attach',
        run_id: 'dag_legacy',
        binding,
      });
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
        timeout_ms: 1_000,
      });
      setImmediate(() => {
        persistNativeDagRun(directory, 'dag_4101', definition);
        attachLaneSupervisorRun({
          persisted: prepared,
          repository_root: directory,
          run_id: 'dag_4101',
        });
      });

      await expect(waiting).resolves.toMatchObject({
        action: 'attach',
        run_id: 'dag_4101',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
