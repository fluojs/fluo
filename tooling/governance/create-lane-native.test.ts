import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const scenarioRunner = resolve(
  repositoryRoot,
  '.agents/skills/create-lane/scripts/run-scenario.mjs',
);
const fixtureRoot = resolve(
  repositoryRoot,
  'tooling/governance/fixtures/create-lane-native',
);

type ScenarioRun = {
  readonly outputRoot: string;
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

const runScenario = (fixtureName: string, outputRoot?: string): ScenarioRun => {
  const root = outputRoot ?? mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
  const stdout = execFileSync(
    process.execPath,
    [
      scenarioRunner,
      '--scenario',
      resolve(fixtureRoot, fixtureName),
      '--out',
      root,
    ],
    { encoding: 'utf8' },
  );
  return { outputRoot: root, result: parseRecord(stdout) };
};

const allFiles = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));

describe('$create-lane native v2 producer', () => {
  it('creates one ready v2 ledger from a native search artifact after three distinct approvals', () => {
    // Given / When
    const run = runScenario('valid-native-artifact.json');

    try {
      // Then
      const ledgerPath = resolve(
        run.outputRoot,
        '.omo/lanes/lane-4101-runtime.json',
      );
      expect(run.result).toEqual({
        status: 'ready',
        ledger: '.omo/lanes/lane-4101-runtime.json',
      });
      expect(allFiles(run.outputRoot)).toEqual([ledgerPath]);
      expect(parseRecord(readFileSync(ledgerPath, 'utf8'))).toEqual({
        version: 2,
        lane_id: 'lane-4101-runtime',
        source: {
          artifact_id: 'search:search-native-runtime',
          sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        issue_number: 4101,
        branch: 'issue-4101-runtime',
        worktree: '.worktrees/issue-4101-runtime',
        head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['reused-approval.json', 'approval_not_distinct'],
    ['mixed-input.json', 'mixed_input'],
    ['malformed-artifact.json', 'invalid_artifact'],
    ['artifact-id-mismatch.json', 'invalid_artifact'],
    ['artifact-sha-mismatch.json', 'invalid_artifact'],
  ])('rejects %s without writing any file', (fixtureName, reason) => {
    // Given / When
    const run = runScenario(fixtureName);

    try {
      // Then
      expect(run.result).toEqual({ status: 'rejected', reason });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('preserves an existing target and leaves no candidate or lock file on collision', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
    const target = resolve(outputRoot, '.omo/lanes/lane-4101-runtime.json');
    mkdirSync(resolve(outputRoot, '.omo/lanes'), { recursive: true });
    writeFileSync(target, '{"existing":true}\n', 'utf8');

    // When
    const run = runScenario('valid-native-artifact.json', outputRoot);

    try {
      // Then
      expect(run.result).toEqual({ status: 'rejected', reason: 'target_collision' });
      expect(readFileSync(target, 'utf8')).toBe('{"existing":true}\n');
      expect(existsSync(`${target}.lock`)).toBe(false);
      expect(allFiles(outputRoot)).toEqual([target]);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
