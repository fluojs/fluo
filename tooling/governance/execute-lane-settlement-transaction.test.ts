import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PersistedState = {
  snapshot: Record<string, any>;
  events: Record<string, any>[];
  receipts: Record<string, any>[];
};
type SupervisorTransport = {
  snapshot: { issue_number: number };
  events: Record<string, any>[];
  receipts: Record<string, any>[];
};

const { settleLaneSupervisorTransports } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-settlement.mjs',
  )
);

describe('execute-lane parent settlement transaction', () => {
  it('imports terminal transports topologically and persists each transition once', () => {
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
        ),
        'utf8',
      ),
    );
    const persisted = {
      snapshot: ledger,
      events: [],
      receipts: [],
    };
    const imported: number[] = [];
    const persistedIssues: number[][] = [];
    const transports = [4102, 4101].map((issueNumber) => ({
      snapshot: { issue_number: issueNumber },
      events: [],
      receipts: [],
    }));

    const settled = settleLaneSupervisorTransports({
      persisted,
      repository_root: process.cwd(),
      supervisor_transports: transports,
      artifact_observations: [],
      import_terminal: (
        state: PersistedState,
        transport: SupervisorTransport,
      ) => {
        const issueNumber = transport.snapshot.issue_number;
        imported.push(issueNumber);
        return {
          ...state,
          snapshot: {
            ...state.snapshot,
            completed_issues: [
              ...state.snapshot.completed_issues,
              issueNumber,
            ],
          },
        };
      },
      terminalize_dependents: (state: PersistedState) => state,
      persist_transition: (
        _previous: PersistedState,
        next: PersistedState,
      ) => {
        persistedIssues.push([...next.snapshot.completed_issues]);
      },
    });

    expect(imported).toEqual([4101, 4102]);
    expect(persistedIssues).toEqual([[4101], [4101, 4102]]);
    expect(settled.snapshot.completed_issues).toEqual([4101, 4102]);
  });

  it('is byte-stable when no import changes state', () => {
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
        ),
        'utf8',
      ),
    );
    const persisted = {
      snapshot: ledger,
      events: [],
      receipts: [],
    };
    let persistCount = 0;

    const settled = settleLaneSupervisorTransports({
      persisted,
      repository_root: process.cwd(),
      supervisor_transports: [],
      artifact_observations: [],
      import_terminal: (state: PersistedState) => state,
      terminalize_dependents: (state: PersistedState) => state,
      persist_transition: () => {
        persistCount += 1;
      },
    });

    expect(settled).toEqual(persisted);
    expect(persistCount).toBe(0);
  });
});
