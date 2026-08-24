import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const intakeScript = resolve(skillRoot, 'scripts/intake.mjs');
const artifactPublisher = resolve(skillRoot, 'scripts/publish-search-artifact.mjs');
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
    return { outputDirectory, result: parseRecord(stdout) };
  } catch (error) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
};

const runRejectedIntake = (...arguments_: readonly string[]) => {
  const result = spawnSync(process.execPath, [intakeScript, ...arguments_], {
    encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  return parseRecord(result.stderr);
};

describe('$search-issue native registration workflow', () => {
  it('publishes a v2 artifact directly under the canonical native path', () => {
    // Given
    const runId = 'search-2026-08-23T210013+0900-jwt';
    const issueNumbers = [920001, 920002];
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'fluo-publisher-'));

    try {
      // When
      const output = parseRecord(
        execFileSync(
          process.execPath,
          [
            artifactPublisher,
            '--run-id',
            runId,
            '--root',
            temporaryRoot,
            '--issues',
            issueNumbers.join(','),
          ],
          { encoding: 'utf8' },
        ),
      );

      // Then
      const artifactPath = `.omo/search-issue/artifacts/${runId}.json`;
      const artifact = parseJsonFile(resolve(temporaryRoot, artifactPath));
      const sha256 = createHash('sha256')
        .update(
          JSON.stringify({
            version: 2,
            artifact_id: `search:${runId}`,
            search_run_id: runId,
            selected_issues: issueNumbers,
          }),
        )
        .digest('hex');
      expect(output).toEqual({ artifact_path: artifactPath, selected_issues: issueNumbers });
      expect(artifact).toEqual({
        version: 2,
        artifact_id: `search:${runId}`,
        sha256,
        search_run_id: runId,
        selected_issues: issueNumbers,
      });
      expect(
        existsSync(resolve(temporaryRoot, '.opencode', 'search-issue')),
      ).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('registers only triage-approved drafts and publishes the exact v2 handoff', () => {
    // Given / When
    const run = runScenario('full-registration.json');

    try {
      // Then
      const ledger = parseJsonFile(resolve(run.outputDirectory, 'ledger.json'));
      const ghCalls = parseJsonArrayFile(resolve(run.outputDirectory, 'gh-calls.json'));
      const artifactPath =
        '.omo/search-issue/artifacts/search-native-full-registration.json';
      const artifact = parseJsonFile(resolve(run.outputDirectory, artifactPath));
      expect(run.result).toEqual({
        status: 'completed',
        invocation_count: 4,
        registered_issue_count: 1,
      });
      expect(ledger).toMatchObject({
        status: 'completed',
        invocations: Array.from({ length: 4 }, () => ({ status: 'completed' })),
        drafts: [{ draft_id: 'D1' }, { draft_id: 'D2' }],
        handoff: {
          artifact_path: artifactPath,
          command: `$create-lane ${artifactPath} main`,
        },
      });
      expect(ghCalls).toEqual([{ draft_id: 'D1', issue_number: 4101 }]);
      expect(artifact).toMatchObject({
        version: 2,
        artifact_id: 'search:search-native-full-registration',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        search_run_id: 'search-native-full-registration',
        selected_issues: [4101],
      });
      expect(existsSync(resolve(run.outputDirectory, 'search-artifact.json'))).toBe(false);
    } finally {
      rmSync(run.outputDirectory, { recursive: true, force: true });
    }
  });

  it('suppresses GitHub mutation and publication in investigation-only mode', () => {
    // Given / When
    const run = runScenario('investigation-only.json');

    try {
      // Then
      const ledger = parseJsonFile(resolve(run.outputDirectory, 'ledger.json'));
      const ghCalls = parseJsonArrayFile(resolve(run.outputDirectory, 'gh-calls.json'));
      expect(ledger).toMatchObject({
        registration_results: [{ draft_id: 'D1', decision: 'register', issue_number: null }],
        handoff: null,
      });
      expect(ghCalls).toEqual([]);
      expect(existsSync(resolve(run.outputDirectory, '.omo/search-issue/artifacts'))).toBe(false);
    } finally {
      rmSync(run.outputDirectory, { recursive: true, force: true });
    }
  });
});

describe('$search-issue native intake resolution', () => {
  it('resolves purpose numbers, visible names, and slugs to canonical slugs', () => {
    // Given / When
    const result = parseRecord(
      execFileSync(
        process.execPath,
        [intakeScript, 'resolve-purposes', '1', '버그 찾기', 'bug-finding'],
        { encoding: 'utf8' },
      ),
    );

    // Then
    expect(result).toEqual({ purposes: ['bug-finding'] });
  });

  it('rejects the ambiguous bare cli token with structured choices', () => {
    // Given / When
    const error = runRejectedIntake('resolve-scope', 'cli');

    // Then
    expect(error).toEqual({
      error: 'ambiguous_selection',
      token: 'cli',
      suggestions: ['패키지군 cli', '패키지 cli'],
    });
  });

  it('returns structured suggestions for an unknown package', () => {
    // Given / When
    const error = runRejectedIntake('resolve', 'package', 'runtim');

    // Then
    expect(error).toEqual({
      error: 'unknown_package',
      token: 'runtim',
      suggestions: ['runtime'],
    });
  });

  it('fails closed when the workspace package catalog drifts', () => {
    // Given
    const workspaceRoot = resolve(fixtureRoot, 'workspace-catalog-drift');

    // When
    const error = runRejectedIntake('verify-workspace', workspaceRoot);

    // Then
    expect(error).toMatchObject({
      error: 'workspace_catalog_drift',
      extra: ['workspace-only'],
      missing: expect.arrayContaining(['core', 'http']),
    });
  });

  it('covers every public package with an allowed package area', () => {
    // Given
    const domain = parseJsonFile(resolve(skillRoot, 'references/domain.json'));
    const packages = domain['packages'];
    const packageArea = domain['package_area'];
    const labels = domain['labels'];

    // When / Then
    expect(Array.isArray(packages)).toBe(true);
    expect(isRecord(packageArea)).toBe(true);
    expect(Array.isArray(labels)).toBe(true);
    if (!Array.isArray(packages) || !isRecord(packageArea) || !Array.isArray(labels)) {
      throw new TypeError('Invalid domain catalog.');
    }
    expect(Object.keys(packageArea).sort()).toEqual([...packages].sort());
    expect(Object.values(packageArea).every((area) => labels.includes(area))).toBe(true);
  });
});

describe('$search-issue malformed scenario intake', () => {
  it.each([
    ['empty-packages.json', 'missing_scope'],
    ['empty-purposes.json', 'missing_purpose'],
  ])('rejects %s without side effects', (fixtureName, reason) => {
    // Given / When
    const run = runScenario(fixtureName);

    try {
      // Then
      expect(run.result).toEqual({ status: 'rejected', reason });
      expect(readdirSync(run.outputDirectory)).toEqual([]);
    } finally {
      rmSync(run.outputDirectory, { recursive: true, force: true });
    }
  });
});
