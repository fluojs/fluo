import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const skillRoot = resolve(root, '.agents/skills/execute-lane');
const stateMachinePath = resolve(skillRoot, 'scripts/state-machine.mjs');
const fixtureRoot = resolve(
  root,
  'tooling/governance/fixtures/execute-lane-native',
);

type ReplayResult = {
  readonly branch: string;
  readonly events: readonly unknown[];
  readonly head_sha: string;
  readonly lane_id: string;
  readonly merge_count: number;
  readonly pr_number: number;
  readonly status: string;
  readonly worktree: string;
};

type ReplayApi = {
  readonly runLaneBatch: (
    scenarios: readonly Record<string, unknown>[],
  ) => readonly ReplayResult[];
  readonly runReplay: (scenario: Record<string, unknown>) => ReplayResult;
};

const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(fixtureRoot, `${name}.json`), 'utf8')) as Record<
    string,
    unknown
  >;

const loadApi = async (): Promise<ReplayApi> => {
  expect(existsSync(stateMachinePath), 'execute state machine must exist').toBe(
    true,
  );
  const loaded: Partial<ReplayApi> = existsSync(stateMachinePath)
    ? ((await import(stateMachinePath)) as Partial<ReplayApi>)
    : {};
  expect(loaded.runReplay, 'runReplay must be exported').toBeTypeOf('function');
  expect(loaded.runLaneBatch, 'runLaneBatch must be exported').toBeTypeOf(
    'function',
  );
  return loaded as ReplayApi;
};

const expectIdentity = (result: ReplayResult): void => {
  expect(result.lane_id).toBe('lane-4101-runtime');
  expect(result.branch).toBe('issue-4101-runtime');
  expect(result.worktree).toBe('.worktrees/issue-4101-runtime');
  expect(result.pr_number).toBe(5101);
};

describe('$execute-lane native replay state machine', () => {
  it.each([
    ['happy', 'done', 1],
    ['fix-then-merge', 'done', 1],
    ['needs-human-check', 'needs-human-check-terminal', 0],
    ['no-progress-budget', 'blocked-budget-exhausted', 0],
    ['malformed-child', 'blocked-child-contract-error', 0],
    ['interrupted-resume', 'done', 1],
    ['cleanup-block', 'blocked-terminal', 1],
  ] as const)(
    'replays %s to %s without unauthorized merges',
    async (fixtureName, status, mergeCount) => {
      const api = await loadApi();
      const result = api.runReplay(readFixture(fixtureName));

      expect(result.status).toBe(status);
      expect(result.merge_count).toBe(mergeCount);
      expect(result.events.length).toBeGreaterThan(0);
      expectIdentity(result);
    },
  );

  it('keeps fix-back on the same PR and requires a new head', async () => {
    const api = await loadApi();
    const result = api.runReplay(readFixture('fix-then-merge'));

    expectIdentity(result);
    expect(result.head_sha).toBe('b'.repeat(40));
  });

  it('progresses independent lanes without a global barrier', async () => {
    const api = await loadApi();
    const waiting = {
      ...readFixture('needs-human-check'),
      lane_id: 'lane-4102-human',
      issue_number: 4102,
      branch: 'issue-4102-human',
      worktree: '.worktrees/issue-4102-human',
      pr: {
        number: 5102,
        url: 'https://github.com/fluojs/fluo/pull/5102',
        head_sha: 'c'.repeat(40),
      },
      steps: [
        {
          kind: 'review',
          verdict: 'needs-human-check',
          reviewed_head: 'c'.repeat(40),
        },
      ],
    };
    const results = api.runLaneBatch([waiting, readFixture('happy')]);

    expect(results.map((result) => result.status)).toEqual([
      'needs-human-check-terminal',
      'done',
    ]);
    expect(results[1]?.merge_count).toBe(1);
  });
});

describe('$execute-lane shipped native assets', () => {
  it('ships the skill, workflow, state machine, and replay CLI', () => {
    expect(
      [
        'SKILL.md',
        'references/workflow.md',
        'scripts/state-machine.mjs',
        'scripts/run-replay.mjs',
      ].filter((path) => existsSync(resolve(skillRoot, path))),
    ).toEqual([
      'SKILL.md',
      'references/workflow.md',
      'scripts/state-machine.mjs',
      'scripts/run-replay.mjs',
    ]);
  });
});
