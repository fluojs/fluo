import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const skillRoot = resolve(repositoryRoot, '.agents/skills/search-issue');
const scenarioRunner = resolve(skillRoot, 'scripts/run-scenario.mjs');
const fixtureRoot = resolve(
  repositoryRoot,
  'tooling/governance/fixtures/search-issue-native',
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new TypeError('Expected a JSON object.');
  }
  return parsed;
};

const parseJsonFile = (path: string): Record<string, unknown> =>
  parseRecord(readFileSync(path, 'utf8'));

const parseJsonArrayFile = (path: string): readonly unknown[] => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new TypeError('Expected a JSON array.');
  }
  return parsed;
};

type ScenarioRun = {
  readonly outputDirectory: string;
  readonly result: Record<string, unknown>;
};

const runScenario = (fixtureName: string): ScenarioRun => {
  const outputDirectory = mkdtempSync(resolve(tmpdir(), 'fluo-search-issue-'));
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        scenarioRunner,
        '--scenario',
        resolve(fixtureRoot, fixtureName),
        '--out',
        outputDirectory,
      ],
      { encoding: 'utf8' },
    );

    return {
      outputDirectory,
      result: parseRecord(stdout),
    };
  } catch (error) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
};

describe('$search-issue native registration workflow', () => {
  it('registers only triage-approved drafts and publishes the exact handoff artifact', () => {
    // Given
    const fixtureName = 'full-registration.json';

    // When
    const run = runScenario(fixtureName);

    try {
      // Then
      const ledger = parseJsonFile(resolve(run.outputDirectory, 'ledger.json'));
      const ghCalls = parseJsonArrayFile(resolve(run.outputDirectory, 'gh-calls.json'));
      const artifact = parseJsonFile(
        resolve(run.outputDirectory, 'search-artifact.json'),
      );

      expect(run.result).toEqual({
        status: 'completed',
        invocation_count: 4,
        registered_issue_count: 1,
      });
      expect(ledger).toMatchObject({
        status: 'completed',
        invocations: [
          { status: 'completed' },
          { status: 'completed' },
          { status: 'completed' },
          { status: 'completed' },
        ],
        drafts: [{ draft_id: 'D1' }, { draft_id: 'D2' }],
        handoff: {
          artifact_path: '.omo/search-issue/search-native-full-registration.json',
          command:
            '$create-lane .omo/search-issue/search-native-full-registration.json main',
        },
      });
      expect(ghCalls).toEqual([{ draft_id: 'D1', issue_number: 4101 }]);
      expect(Object.keys(artifact).sort()).toEqual([
        'search_run_id',
        'selected_issues',
        'version',
      ]);
      expect(artifact).toEqual({
        version: 1,
        search_run_id: 'search-native-full-registration',
        selected_issues: [4101],
      });
    } finally {
      rmSync(run.outputDirectory, { recursive: true, force: true });
    }
  });

  it('suppresses registration and artifact publication in investigation-only mode', () => {
    // Given / When
    const run = runScenario('investigation-only.json');

    try {
      // Then
      const ledger = parseJsonFile(resolve(run.outputDirectory, 'ledger.json'));
      const ghCalls = parseJsonArrayFile(resolve(run.outputDirectory, 'gh-calls.json'));

      expect(run.result).toEqual({
        status: 'completed',
        invocation_count: 1,
        registered_issue_count: 0,
      });
      expect(ledger).toMatchObject({
        status: 'completed',
        registration_results: [
          {
            draft_id: 'D1',
            decision: 'register',
            issue_number: null,
          },
        ],
        handoff: null,
      });
      expect(ghCalls).toEqual([]);
      expect(
        existsSync(resolve(run.outputDirectory, 'search-artifact.json')),
      ).toBe(false);
    } finally {
      rmSync(run.outputDirectory, { recursive: true, force: true });
    }
  });
});

describe('$search-issue malformed intake', () => {
  it.each([
    ['empty-packages.json', 'missing_scope'],
    ['empty-purposes.json', 'missing_purpose'],
  ])(
    'rejects %s before ledger, reviewer, or registration side effects',
    (fixtureName, reason) => {
      // Given / When
      const run = runScenario(fixtureName);

      try {
        // Then
        expect(run.result).toEqual({
          status: 'rejected',
          reason,
        });
        expect(readdirSync(run.outputDirectory)).toEqual([]);
      } finally {
        rmSync(run.outputDirectory, { recursive: true, force: true });
      }
    },
  );

  it('rejects an unknown package before ledger, reviewer, or registration side effects', () => {
    // Given
    const fixtureName = 'unknown-package.json';

    // When
    const run = runScenario(fixtureName);

    try {
      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'unknown_package',
        package: '__missing_fluo_package__',
      });
      expect(readdirSync(run.outputDirectory)).toEqual([]);
    } finally {
      rmSync(run.outputDirectory, { recursive: true, force: true });
    }
  });
});
