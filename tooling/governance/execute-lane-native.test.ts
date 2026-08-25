import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

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
  repositoryRoot?: string,
): ScenarioRun => {
  const state =
    stateDirectory ?? mkdtempSync(resolve(tmpdir(), 'fluo-execute-lane-'));
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
  const stdout = execFileSync(
    process.execPath,
    command,
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
    const ledgerPath = resolve(
      fixtureDirectory,
      '.omo/lanes/lane-4101-runtime.json',
    );
    const approvalReceiptPath = resolve(
      fixtureDirectory,
      '.omo/approvals/approval-lane-4101-runtime-lane-plan.json',
    );
    const artifactPath = resolve(
      fixtureDirectory,
      '.omo/search-issue/artifacts/search-native-two-lanes.json',
    );
    const scenarioPath = resolve(fixtureRoot, 'interrupted-start.json');
    const secondScenarioPath = resolve(fixtureDirectory, 'second.json');
    const ledger = readFixture('ready-ledger-two-lanes-v2');
    mkdirSync(dirname(ledgerPath), { recursive: true });
    mkdirSync(dirname(approvalReceiptPath), { recursive: true });
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      ledgerPath,
      `${JSON.stringify(
        { ...ledger, release_handoffs: [4101, 4102] },
        null,
        2,
      )}\n`,
      'utf8',
    );
    writeFileSync(
      approvalReceiptPath,
      `${JSON.stringify(
        readFixture('release-handoff-two-lanes-approval'),
        null,
        2,
      )}\n`,
      'utf8',
    );
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        readFixture('search-native-two-lanes'),
        null,
        2,
      )}\n`,
      'utf8',
    );
    writeFileSync(
      secondScenarioPath,
      `${JSON.stringify(
        {
          lane_id: 'lane-4101-runtime',
          issue_number: 4102,
          branch: 'issue-4102-runtime',
          worktree: '.worktrees/issue-4102-runtime',
          pr: {
            number: 5102,
            url: 'https://github.com/fluojs/fluo/pull/5102',
            head_sha: 'b'.repeat(40),
          },
          steps: [{ kind: 'interrupt' }],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const run = runScenarioPath(
      scenarioPath,
      undefined,
      ledgerPath,
      fixtureDirectory,
    );
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
      const completed = runScenarioPath(
        secondScenarioPath,
        run.stateDirectory,
        ledgerPath,
        fixtureDirectory,
      );
      const completedSnapshot = completed.result['snapshot'];
      expect(completed.result['status']).toBe('blocked-maintainer-decision');
      expect(
        isRecord(completedSnapshot) &&
          Array.isArray(completedSnapshot['lanes'])
          ? completedSnapshot['lanes'].map((lane) => lane['status'])
          : [],
      ).toEqual([
        'blocked-maintainer-decision',
        'blocked-maintainer-decision',
      ]);
    } finally {
      rmSync(run.stateDirectory, { recursive: true, force: true });
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a release handoff without its consumed approval receipt', () => {
    const fixtureDirectory = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-release-approval-'),
    );
    const ledgerPath = resolve(
      fixtureDirectory,
      '.omo/lanes/lane-4101-runtime.json',
    );
    const artifactPath = resolve(
      fixtureDirectory,
      '.omo/search-issue/artifacts/search-native-release.json',
    );
    const ledger = readFixture('ready-ledger-release-v2');
    mkdirSync(dirname(ledgerPath), { recursive: true });
    mkdirSync(
      resolve(fixtureDirectory, '.omo/approvals'),
      { recursive: true },
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      ledgerPath,
      `${JSON.stringify(ledger, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      artifactPath,
      `${JSON.stringify(readFixture('search-native-release'), null, 2)}\n`,
      'utf8',
    );

    try {
      expect(() =>
        runScenarioPath(
          resolve(fixtureRoot, 'interrupted-start.json'),
          undefined,
          ledgerPath,
        ),
      ).toThrow(/release handoffs require their consumed lane-plan approval receipt/u);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('rejects removing approved handoffs from a bound ledger', () => {
    const repositoryRoot = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-release-removal-'),
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
    const ledger = structuredClone(
      readFixture('ready-ledger-release-v2'),
    ) as Record<string, unknown>;
    ledger['release_handoffs'] = [];
    for (const [path, value] of [
      [ledgerPath, ledger],
      [approvalPath, readFixture('release-handoff-approval')],
      [artifactPath, readFixture('search-native-release')],
    ] as const) {
      writeFileSync(
        path,
        `${JSON.stringify(value, null, 2)}\n`,
        'utf8',
      );
    }

    try {
      expect(() =>
        runScenarioPath(
          resolve(fixtureRoot, 'interrupted-start.json'),
          undefined,
          ledgerPath,
          repositoryRoot,
        ),
      ).toThrow(
        /release handoffs do not match their lane-plan approval receipt/u,
      );
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'binding',
      (receipt: Record<string, unknown>) => {
        receipt['binding_sha256'] = 'c'.repeat(64);
      },
      /release handoff approval binding does not match/u,
    ],
    [
      'evidence digest',
      (receipt: Record<string, unknown>) => {
        const attestations = receipt['release_handoff_attestations'];
        if (!Array.isArray(attestations) || !isRecord(attestations[0])) {
          throw new TypeError('release approval attestations must be objects');
        }
        attestations[0] = {
          ...attestations[0],
          issue_evidence_sha256: 'c'.repeat(64),
        };
      },
      /release handoff attestations do not match the approved plan/u,
    ],
    [
      'self-consistent approval ID',
      (receipt: Record<string, unknown>) => {
        receipt['approval_id'] = 'approval-forged-lane-plan';
        receipt['binding_sha256'] =
          '091dc0f20c97675db7ea0a0675a3aec817d8f511487fb6a17dce7df36c558203';
      },
      /release handoffs require their consumed lane-plan approval receipt/u,
    ],
    [
      'fully self-consistent evidence digest',
      (receipt: Record<string, unknown>) => {
        const attestations = receipt['release_handoff_attestations'];
        const plan = receipt['plan'];
        const handoffs = isRecord(plan) ? plan['release_handoffs'] : undefined;
        if (
          !Array.isArray(attestations) ||
          !isRecord(attestations[0]) ||
          !Array.isArray(handoffs) ||
          !isRecord(handoffs[0])
        ) {
          throw new TypeError('release approval attestations must be objects');
        }
        attestations[0] = {
          ...attestations[0],
          issue_evidence_sha256: 'c'.repeat(64),
        };
        handoffs[0] = {
          ...handoffs[0],
          issue_evidence_sha256: 'c'.repeat(64),
        };
        receipt['binding_sha256'] =
          'c2d14b0a464ca206669e9c32791f8eda3326406158a8896bad79c8c65fac5247';
      },
      /release handoff receipt binding does not match the ledger/u,
    ],
  ])('rejects a substituted release handoff %s', (_, mutate, error) => {
    const repositoryRoot = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-release-substitution-'),
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
    const receipt = structuredClone(
      readFixture('release-handoff-approval'),
    ) as Record<string, unknown>;
    mutate(receipt);
    for (const [path, value] of [
      [ledgerPath, readFixture('ready-ledger-release-v2')],
      [approvalPath, receipt],
      [artifactPath, readFixture('search-native-release')],
    ] as const) {
      writeFileSync(
        path,
        `${JSON.stringify(value, null, 2)}\n`,
        'utf8',
      );
    }

    try {
      expect(() =>
        runScenarioPath(
          resolve(fixtureRoot, 'interrupted-start.json'),
          undefined,
          ledgerPath,
          repositoryRoot,
        ),
      ).toThrow(error);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
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
        'scripts/release-handoff-approval.mjs',
        'scripts/fixtures/run-replay.mjs',
      ].filter((path) => existsSync(resolve(skillRoot, path))),
    ).toHaveLength(6);
  });

  it.each([
    'ready-ledger-release-v2.json',
    'ready-ledger-two-lanes-v2.json',
  ])('serializes one lane-plan approval binding in %s', (fixture) => {
    const source = readFileSync(resolve(fixtureRoot, fixture), 'utf8');
    expect(source.match(/"lane_plan_approval_sha256"/gu)).toHaveLength(1);
  });
});
