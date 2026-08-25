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
const fixtures = resolve(
  root,
  'tooling/governance/fixtures/execute-lane-native',
);
const replay = resolve(
  root,
  '.agents/skills/execute-lane/scripts/fixtures/run-replay.mjs',
);
const verifier = resolve(root, 'tooling/governance/verify-lane-ledger.mjs');

const parseRecord = (value: string): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new TypeError('Expected a JSON object.');
  }
  return Object.fromEntries(Object.entries(parsed));
};

const run = (
  scenarioPath: string,
  state: string,
  ledgerPath: string,
): Readonly<Record<string, unknown>> =>
  parseRecord(
    execFileSync(
      process.execPath,
      [
        replay,
        '--fixture-only',
        '--scenario',
        scenarioPath,
        '--ledger',
        ledgerPath,
        '--state-dir',
        state,
      ],
      { encoding: 'utf8' },
    ),
  );

describe('$execute-lane sibling lane independence', () => {
  it('continues a sibling after human escalation and preserves the root blocker', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-siblings-'));
    const input = mkdtempSync(resolve(tmpdir(), 'fluo-execute-input-'));
    try {
      const ledger = parseRecord(
        readFileSync(
          resolve(fixtures, 'ready-ledger-two-lanes-v2.json'),
          'utf8',
        ),
      );
      const ledgerPath = resolve(input, 'legacy-two-lanes-v2.json');
      const legacyLedger = { ...ledger };
      Reflect.deleteProperty(
        legacyLedger,
        'lane_plan_approval_sha256',
      );
      writeFileSync(
        ledgerPath,
        `${JSON.stringify(legacyLedger, null, 2)}\n`,
        'utf8',
      );
      const first = run(
        resolve(fixtures, 'needs-human-check.json'),
        state,
        ledgerPath,
      );
      expect(first['status']).toBe('running');

      const secondRaw = readFileSync(resolve(fixtures, 'happy.json'), 'utf8')
        .replaceAll('4101', '4102')
        .replaceAll('5101', '5102');
      const second = parseRecord(secondRaw);
      const secondPath = resolve(input, 'second.json');
      writeFileSync(
        secondPath,
        `${JSON.stringify(
          { ...second, lane_id: 'lane-4101-runtime' },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const completed = run(secondPath, state, ledgerPath);
      expect(completed['status']).toBe('needs-human-check-terminal');
      expect(completed['merge_count']).toBe(1);
      expect(
        execFileSync(
          process.execPath,
          [verifier, resolve(state, 'snapshot.json')],
          { encoding: 'utf8' },
        ),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(state, { recursive: true, force: true });
      rmSync(input, { recursive: true, force: true });
    }
  });
});
