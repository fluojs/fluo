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

describe('$create-lane multi-issue planning', () => {
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
      '1c25fbb6fb6daba018f9cd0b13a10dad3b8269ba01c70259ee357419974a9a05',
      'a9023a7891f871ee0490a04f0ce52b3bbf9255ce7ea303cfc33884ba07e8b285',
      '7e554e8c310b61085755069f1e759437e18d369fdec6da303ff569009a8c8eaf',
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
});
