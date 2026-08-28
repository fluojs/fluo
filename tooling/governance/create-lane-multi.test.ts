import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const fixtureRoot = resolve(
  root,
  'tooling/governance/fixtures/create-lane-native',
);
const runner = resolve(
  root,
  '.agents/skills/create-lane/scripts/fixtures/run-scenario.mjs',
);
const verifier = resolve(root, 'tooling/governance/verify-lane-ledger.mjs');
const { approvalBinding } = (await import(
  resolve(
    root,
    '.agents/skills/create-lane/scripts/approval-contracts.mjs',
  )
)) as {
  approvalBinding: (
    approval: Readonly<Record<string, unknown>>,
    artifact: Readonly<Record<string, unknown>>,
    plan: Readonly<Record<string, unknown>>,
  ) => string;
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

const runValue = (
  scenario: Readonly<Record<string, unknown>>,
): {
  readonly outputRoot: string;
  readonly result: Readonly<Record<string, unknown>>;
} => {
  const inputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-input-'));
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
  const path = resolve(inputRoot, 'scenario.json');
  try {
    writeFileSync(path, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
    const stdout = execFileSync(
      process.execPath,
      [runner, '--fixture-only', '--scenario', path, '--out', outputRoot],
      { encoding: 'utf8' },
    );
    return { outputRoot, result: parseRecord(stdout) };
  } finally {
    rmSync(inputRoot, { recursive: true, force: true });
  }
};

const rebindApprovals = (
  fixture: Readonly<Record<string, unknown>>,
  plan: Readonly<Record<string, unknown>>,
  approvals: readonly unknown[],
): readonly unknown[] => {
  const intake = fixture['intake'];
  const artifacts = fixture['artifacts'];
  if (
    !isRecord(intake) ||
    typeof intake['artifact_path'] !== 'string' ||
    !isRecord(artifacts)
  ) {
    throw new TypeError('multi fixture must bind one artifact intake');
  }
  const artifact = artifacts[intake['artifact_path']];
  if (!isRecord(artifact)) {
    throw new TypeError('multi fixture artifact must be an object');
  }
  return approvals.map((approval) =>
    isRecord(approval)
      ? {
          ...approval,
          binding_sha256: approvalBinding(approval, artifact, plan),
        }
      : approval,
  );
};

describe('$create-lane multi-issue planning', () => {
  it('rejects related recommendations when opt-in was not requested', () => {
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-multi-issue.json'), 'utf8'),
    );
    const { recommend_issues: _recommendIssues, ...withoutOptIn } = fixture;
    const run = runValue(withoutOptIn);
    try {
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'recommendations_not_requested',
      });
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('creates approved additions, lane grouping, and dependencies', () => {
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-multi-issue.json'), 'utf8'),
    );
    const run = runValue(fixture);
    try {
      const ledgerPath = resolve(
        run.outputRoot,
        '.omo/lanes/lane-4101-4103-runtime.json',
      );
      const ledger = parseRecord(readFileSync(ledgerPath, 'utf8'));
      expect(ledger['confirmed_issues']).toEqual([4101, 4102, 4103]);
      expect(ledger['dependency_graph']).toEqual({ '4103': [4101] });
      expect(ledger['lanes']).toHaveLength(2);
      expect(
        execFileSync(process.execPath, [verifier, ledgerPath], {
          encoding: 'utf8',
        }),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('preserves a dependency on an external prerequisite', () => {
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-multi-issue.json'), 'utf8'),
    );
    const plan = fixture['plan'];
    const approvals = fixture['approvals'];
    if (!isRecord(plan) || !Array.isArray(approvals)) {
      throw new TypeError('multi fixture must contain plan and approvals');
    }
    const bindings = [
      '2651ce0f27de175c359c93dd385225c897e840456b12b309179d08832032dc84',
      '85a2504925c8dacc099e3015d9f6866ad67172421e7f4b5b6a1c7fab700f29d1',
      'fe1f72c55424d816876e9c2981e3a404d8f8a577a7b3791a49cfb58a41d2e680',
    ];
    const run = runValue({
      ...fixture,
      plan: { ...plan, dependency_graph: { '4103': [9999] } },
      approvals: approvals.map((approval, index) =>
        isRecord(approval)
          ? { ...approval, binding_sha256: bindings[index] }
          : approval,
      ),
    });
    try {
      expect(run.result['status']).toBe('ready');
      expect(
        execFileSync(
          process.execPath,
          [
            verifier,
            resolve(
              run.outputRoot,
              '.omo/lanes/lane-4101-4103-runtime.json',
            ),
          ],
          { encoding: 'utf8' },
        ),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects an additions response that does not partition recommendations', () => {
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-multi-issue.json'), 'utf8'),
    );
    const plan = fixture['plan'];
    const approvals = fixture['approvals'];
    if (!isRecord(plan) || !Array.isArray(approvals) || !isRecord(approvals[1])) {
      throw new TypeError('multi fixture must contain plan and approvals');
    }
    const changedPlan = {
      ...plan,
      confirmed_issues: [4101, 4102],
      suggested_but_excluded: [],
      lanes: [{ name: 'runtime', queue: [4101, 4102] }],
      dependency_graph: {},
    };
    const changedApprovals = approvals.map((approval, index) =>
      index === 1 && isRecord(approval)
        ? { ...approval, issue_numbers: [] }
        : approval,
    );

    const run = runValue({
      ...fixture,
      plan: changedPlan,
      approvals: rebindApprovals(
        fixture,
        changedPlan,
        changedApprovals,
      ),
    });
    try {
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'approval_not_distinct',
      });
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });
});
