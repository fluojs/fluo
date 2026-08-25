import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const fixtureRoot = resolve(
  root,
  'tooling/governance/fixtures/execute-lane-native',
);
const replayCli = resolve(
  root,
  '.agents/skills/execute-lane/scripts/fixtures/run-replay.mjs',
);
const verifier = resolve(root, 'tooling/governance/verify-lane-ledger.mjs');

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
  ledgerPath: string,
  state: string,
  repositoryRoot?: string,
): Readonly<Record<string, unknown>> => {
  const command = [
    replayCli,
    '--fixture-only',
    '--scenario',
    scenarioPath,
    '--ledger',
    ledgerPath,
    '--state-dir',
    state,
  ];
  if (repositoryRoot !== undefined) {
    command.push('--repository-root', repositoryRoot);
  }
  return parseRecord(
    execFileSync(process.execPath, command, { encoding: 'utf8' }),
  );
};

const runScenarioValue = (
  scenario: Readonly<Record<string, unknown>>,
  ledgerName: string,
  state: string,
  repositoryRoot?: string,
): Readonly<Record<string, unknown>> => {
  const inputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-execute-input-'));
  const scenarioPath = resolve(inputRoot, 'scenario.json');
  try {
    writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
    return runScenarioPath(
      scenarioPath,
      resolve(fixtureRoot, ledgerName),
      state,
      repositoryRoot,
    );
  } finally {
    rmSync(inputRoot, { recursive: true, force: true });
  }
};

const withoutRootSync = (): Readonly<Record<string, unknown>> => {
  const scenario = readFixture('happy');
  const steps = scenario['steps'];
  if (!Array.isArray(steps)) {
    throw new TypeError('happy fixture steps must be an array.');
  }
  return { ...scenario, steps: steps.slice(0, -1) };
};

const secondIssueScenario = (): Readonly<Record<string, unknown>> => {
  const serialized = JSON.stringify(readFixture('happy'))
    .replaceAll('4101', '4102')
    .replaceAll('5101', '5102');
  return { ...parseRecord(serialized), lane_id: 'lane-4101-runtime' };
};

describe('$execute-lane multi-issue and trust boundaries', () => {
  it('waits for dependencies, advances the queue, and syncs only after all issues finish', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-multi-'));
    const ledger = 'ready-ledger-multi-v2.json';
    try {
      const dependencyWait = runScenarioValue(
        secondIssueScenario(),
        ledger,
        state,
      );
      expect(dependencyWait['status']).toBe('dependency-blocked');

      const first = runScenarioValue(withoutRootSync(), ledger, state);
      expect(first['status']).toBe('running');
      const firstSnapshot = parseRecord(
        readFileSync(resolve(state, 'snapshot.json'), 'utf8'),
      );
      expect(firstSnapshot['completed_issues']).toEqual([4101]);

      const second = runScenarioValue(secondIssueScenario(), ledger, state);
      expect(second['status']).toBe('done');
      expect(second['merge_count']).toBe(2);
      expect(
        execFileSync(
          process.execPath,
          [verifier, resolve(state, 'snapshot.json')],
          { encoding: 'utf8' },
        ),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('parks a release handoff for explicit maintainer decision without side effects', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-release-'));
    const repositoryRoot = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-release-root-'),
    );
    const ledgerPath = resolve(
      repositoryRoot,
      '.omo/lanes/lane-4101-runtime.json',
    );
    const approvalPath = resolve(
      repositoryRoot,
      '.omo/approvals/approval-lane-4101-runtime-lane-plan.json',
    );
    const artifactPath = resolve(
      repositoryRoot,
      '.omo/search-issue/artifacts/search-native-release.json',
    );
    mkdirSync(dirname(ledgerPath), { recursive: true });
    mkdirSync(dirname(approvalPath), { recursive: true });
    mkdirSync(dirname(artifactPath), { recursive: true });
    for (const [path, fixture] of [
      [ledgerPath, 'ready-ledger-release-v2'],
      [approvalPath, 'release-handoff-approval'],
      [artifactPath, 'search-native-release'],
    ] as const) {
      writeFileSync(
        path,
        `${JSON.stringify(readFixture(fixture), null, 2)}\n`,
        'utf8',
      );
    }
    try {
      const result = runScenarioValue(
        readFixture('happy'),
        ledgerPath,
        state,
        repositoryRoot,
      );
      expect(result['status']).toBe('blocked-maintainer-decision');
      expect(result['merge_count']).toBe(0);
      expect(
        execFileSync(
          process.execPath,
          [verifier, resolve(state, 'snapshot.json')],
          { encoding: 'utf8' },
        ),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(state, { recursive: true, force: true });
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('rejects branch and PR substitution during persisted resume', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-resume-'));
    const ledger = 'ready-ledger-v2.json';
    try {
      runScenarioValue(readFixture('interrupted-start'), ledger, state);
      const substituted = JSON.stringify(readFixture('interrupted-resume'))
        .replaceAll('issue-4101-runtime', 'issue-4101-substituted')
        .replaceAll('5101', '5999');
      const result = runScenarioValue(parseRecord(substituted), ledger, state);
      expect(result['status']).toBe('blocked-ledger-conflict');
      expect(result['merge_count']).toBe(0);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('rejects duplicate blocker signatures with substituted evidence', () => {
    const scenario = structuredClone(readFixture('fix-then-merge'));
    const steps = scenario['steps'];
    if (
      !Array.isArray(steps) ||
      !isRecord(steps[0]) ||
      !isRecord(steps[1]) ||
      !Array.isArray(steps[0]['reviews'])
    ) {
      throw new TypeError('fix fixture must contain review and fix steps.');
    }
    const reviews = [...steps[0]['reviews']];
    const codeReview = reviews.find(
      (review) => isRecord(review) && review['reviewer'] === 'code',
    );
    if (!isRecord(codeReview) || !Array.isArray(codeReview['blockers'])) {
      throw new TypeError('fix fixture must contain one code blocker.');
    }
    reviews[0] = {
      reviewer: 'contract',
      reviewed_head_sha: 'a'.repeat(40),
      verdict_signal: 'BLOCK',
      blockers: [
        {
          ...codeReview['blockers'][0],
          reviewer: 'contract',
          evidence: 'different evidence',
        },
      ],
    };
    steps[0] = { ...steps[0], reviews };
    steps[1] = {
      ...steps[1],
      addressed_blockers: [
        'runtime:code:worker:abort-path',
        'runtime:code:worker:abort-path',
      ],
    };
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-blockers-'));
    try {
      const result = runScenarioValue(
        scenario,
        'ready-ledger-v2.json',
        state,
      );
      expect(result['status']).toBe('blocked-child-contract-error');
      expect(result['merge_count']).toBe(0);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked event stream without modifying its target', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-symlink-'));
    const outside = resolve(state, '..', `${state.split('/').at(-1)}-outside`);
    writeFileSync(outside, 'outside\n', 'utf8');
    symlinkSync(outside, resolve(state, 'events.jsonl'));
    try {
      expect(() =>
        runScenarioValue(readFixture('happy'), 'ready-ledger-v2.json', state),
      ).toThrow();
      expect(readFileSync(outside, 'utf8')).toBe('outside\n');
    } finally {
      rmSync(state, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });

});
