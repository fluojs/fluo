import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const skillRoot = resolve(root, '.agents/skills/execute-lane');
const replayCli = resolve(skillRoot, 'scripts/fixtures/run-replay.mjs');
const ledgerVerifier = resolve(
  root,
  'tooling/governance/verify-lane-ledger.mjs',
);
const fixtureRoot = resolve(
  root,
  'tooling/governance/fixtures/execute-lane-native',
);
const initialLedger = resolve(fixtureRoot, 'ready-ledger-v2.json');

type ScenarioRun = {
  readonly stateDirectory: string;
  readonly result: Readonly<Record<string, unknown>>;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (value: string): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new TypeError('Expected a JSON object.');
  }
  return parsed;
};

const readFixture = (name: string): Readonly<Record<string, unknown>> =>
  parseRecord(readFileSync(resolve(fixtureRoot, `${name}.json`), 'utf8'));

const runScenarioPath = (
  scenarioPath: string,
  stateDirectory?: string,
  ledgerPath = initialLedger,
): ScenarioRun => {
  const state =
    stateDirectory ?? mkdtempSync(resolve(tmpdir(), 'fluo-execute-lane-'));
  const stdout = execFileSync(
    process.execPath,
    [
      replayCli,
      '--fixture-only',
      '--scenario',
      scenarioPath,
      '--ledger',
      ledgerPath,
      '--state-dir',
      state,
    ],
    { encoding: 'utf8' },
  );
  return { stateDirectory: state, result: parseRecord(stdout) };
};

const runScenario = (
  fixtureName: string,
  stateDirectory?: string,
): ScenarioRun =>
  runScenarioPath(resolve(fixtureRoot, `${fixtureName}.json`), stateDirectory);

const runScenarioValue = (
  scenario: Readonly<Record<string, unknown>>,
): ScenarioRun => {
  const scenarioRoot = mkdtempSync(resolve(tmpdir(), 'fluo-execute-input-'));
  const scenarioPath = resolve(scenarioRoot, 'scenario.json');
  try {
    writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
    return runScenarioPath(scenarioPath);
  } finally {
    rmSync(scenarioRoot, { recursive: true, force: true });
  }
};

const expectIdentity = (
  result: Readonly<Record<string, unknown>>,
): void => {
  expect(result['lane_id']).toBe('lane-4101-runtime');
  expect(result['branch']).toBe('issue-4101-runtime');
  expect(result['worktree']).toBe('.worktrees/issue-4101-runtime');
  expect(result['pr_number']).toBe(5101);
};

describe('$execute-lane persisted native state machine', () => {
  it.each([
    ['happy', 'done', 1],
    ['fix-then-merge', 'done', 1],
    ['needs-human-check', 'needs-human-check-terminal', 0],
    ['no-progress-budget', 'blocked-budget-exhausted', 0],
    ['malformed-child', 'blocked-child-contract-error', 0],
    ['cleanup-block', 'blocked-terminal', 1],
  ] as const)(
    'replays %s to %s without unauthorized merges',
    (fixtureName, status, mergeCount) => {
      const run = runScenario(fixtureName);
      try {
        expect(run.result['status']).toBe(status);
        expect(run.result['merge_count']).toBe(mergeCount);
        expectIdentity(run.result);
        expect(
          execFileSync(
            process.execPath,
            [ledgerVerifier, resolve(run.stateDirectory, 'snapshot.json')],
            { encoding: 'utf8' },
          ),
        ).toContain('Lane ledger check passed for 1 file(s).');
      } finally {
        rmSync(run.stateDirectory, { recursive: true, force: true });
      }
    },
  );

  it('rejects an incomplete reviewer triad without creating a merge receipt', () => {
    const scenario = readFixture('happy');
    const steps = scenario['steps'];
    if (!Array.isArray(steps) || !isRecord(steps[0])) {
      throw new TypeError('happy fixture must contain a review step');
    }
    const reviews = steps[0]['reviews'];
    if (!Array.isArray(reviews)) {
      throw new TypeError('happy review step must contain reviews');
    }
    const run = runScenarioValue({
      ...scenario,
      steps: [{ ...steps[0], reviews: reviews.slice(0, 2) }],
    });
    try {
      expect(run.result['status']).toBe('blocked-child-contract-error');
      expect(run.result['merge_count']).toBe(0);
    } finally {
      rmSync(run.stateDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a merge observation that does not bind the live PR identity', () => {
    const scenario = readFixture('happy');
    const steps = scenario['steps'];
    if (!Array.isArray(steps) || !isRecord(steps[0])) {
      throw new TypeError('happy fixture must contain a review step');
    }
    const observation = steps[0]['merge_observation'];
    if (!isRecord(observation)) {
      throw new TypeError('happy review step must contain merge observation');
    }
    const run = runScenarioValue({
      ...scenario,
      steps: [
        {
          ...steps[0],
          merge_observation: {
            ...observation,
            pr_url: 'https://evil.invalid/pull/5101',
          },
        },
      ],
    });
    try {
      expect(run.result['status']).toBe('blocked-child-contract-error');
      expect(run.result['merge_count']).toBe(0);
    } finally {
      rmSync(run.stateDirectory, { recursive: true, force: true });
    }
  });

  it('keeps fix-back on the same PR and requires a new head', () => {
    const run = runScenario('fix-then-merge');
    try {
      expectIdentity(run.result);
      expect(run.result['head_sha']).toBe('b'.repeat(40));
    } finally {
      rmSync(run.stateDirectory, { recursive: true, force: true });
    }
  });

  it('does not impose a global barrier between independent lane states', () => {
    const waiting = runScenario('needs-human-check');
    const completed = runScenario('happy');
    try {
      expect(waiting.result['status']).toBe('needs-human-check-terminal');
      expect(completed.result['status']).toBe('done');
      expect(completed.result['merge_count']).toBe(1);
    } finally {
      rmSync(waiting.stateDirectory, { recursive: true, force: true });
      rmSync(completed.stateDirectory, { recursive: true, force: true });
    }
  });

  it('parks one release handoff while another remains queued', () => {
    const fixtureDirectory = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-release-handoffs-'),
    );
    const ledgerPath = resolve(fixtureDirectory, 'ledger.json');
    const scenarioPath = resolve(fixtureRoot, 'interrupted-start.json');
    const ledger = readFixture('ready-ledger-two-lanes-v2');
    writeFileSync(
      ledgerPath,
      `${JSON.stringify(
        { ...ledger, release_handoffs: [4101, 4102] },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const run = runScenarioPath(scenarioPath, undefined, ledgerPath);
    try {
      const snapshot = run.result['snapshot'];
      if (!isRecord(snapshot)) {
        throw new TypeError('result snapshot must be an object');
      }
      const lanes = snapshot['lanes'];
      expect(run.result['status']).toBe('running');
      expect(Array.isArray(lanes) ? lanes.map((lane) => lane['status']) : []).toEqual([
        'blocked-maintainer-decision',
        'queued',
      ]);
    } finally {
      rmSync(run.stateDirectory, { recursive: true, force: true });
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

describe('$execute-lane shipped native assets', () => {
  it('ships the skill, workflow, state machine, store, and replay CLI', () => {
    expect(
      [
        'SKILL.md',
        'references/workflow.md',
        'scripts/state-machine.mjs',
        'scripts/state-store.mjs',
        'scripts/fixtures/run-replay.mjs',
      ].filter((path) => existsSync(resolve(skillRoot, path))),
    ).toHaveLength(5);
  });
});
