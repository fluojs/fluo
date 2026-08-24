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
  'tooling/governance/fixtures/execute-lane-native',
);
const replayCli = resolve(
  root,
  '.agents/skills/execute-lane/scripts/fixtures/run-replay.mjs',
);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (value: string): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new TypeError('Expected a JSON object.');
  }
  return parsed;
};

describe('$execute-lane authority scope', () => {
  it('records cleanup and root sync as skipped when authority is absent', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-authority-'));
    const ledger = parseRecord(
      readFileSync(resolve(fixtureRoot, 'ready-ledger-v2.json'), 'utf8'),
    );
    const authority = ledger['authority_scope'];
    if (!isRecord(authority)) {
      throw new TypeError('ready ledger must contain authority_scope');
    }
    const ledgerPath = resolve(state, 'input-ledger.json');
    writeFileSync(
      ledgerPath,
      `${JSON.stringify(
        {
          ...ledger,
          authority_scope: {
            ...authority,
            cleanup_command_worktrees: false,
            root_main_sync_ff_only: false,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    try {
      const result = parseRecord(
        execFileSync(
          process.execPath,
          [
            replayCli,
            '--fixture-only',
            '--scenario',
            resolve(fixtureRoot, 'happy.json'),
            '--ledger',
            ledgerPath,
            '--state-dir',
            state,
          ],
          { encoding: 'utf8' },
        ),
      );
      const snapshot = result['snapshot'];
      const receipts = result['receipts'];
      if (!isRecord(snapshot) || !Array.isArray(receipts)) {
        throw new TypeError('execute result must contain snapshot and receipts');
      }
      expect(snapshot['root_main_sync']).toEqual({
        status: 'skipped-authority',
        sha: null,
      });
      expect(
        receipts
          .filter(
            (item) =>
              isRecord(item) &&
              ['worktree.remove', 'branch.delete', 'root.sync'].includes(
                String(item['side_effect']),
              ),
          )
          .every((item) => isRecord(item) && item['status'] === 'skipped'),
      ).toBe(true);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});
