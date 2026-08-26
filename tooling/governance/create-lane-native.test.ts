import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const scenarioRunner = resolve(
  repositoryRoot,
  '.agents/skills/create-lane/scripts/fixtures/run-scenario.mjs',
);
const fixtureRoot = resolve(
  repositoryRoot,
  'tooling/governance/fixtures/create-lane-native',
);
const ledgerVerifier = resolve(
  repositoryRoot,
  'tooling/governance/verify-lane-ledger.mjs',
);
const executeReplay = resolve(
  repositoryRoot,
  '.agents/skills/execute-lane/scripts/fixtures/run-replay.mjs',
);
const executeFixtureRoot = resolve(
  repositoryRoot,
  'tooling/governance/fixtures/execute-lane-native',
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

const runScenarioPath = (
  scenarioPath: string,
  outputRoot?: string,
): ScenarioRun => {
  const root = outputRoot ?? mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
  const stdout = execFileSync(
    process.execPath,
    [
      scenarioRunner,
      '--fixture-only',
      '--scenario',
      scenarioPath,
      '--out',
      root,
    ],
    { encoding: 'utf8' },
  );
  return { outputRoot: root, result: parseRecord(stdout) };
};

const runScenario = (fixtureName: string, outputRoot?: string): ScenarioRun =>
  runScenarioPath(resolve(fixtureRoot, fixtureName), outputRoot);

const runScenarioValue = (
  scenario: Readonly<Record<string, unknown>>,
  outputRoot?: string,
): ScenarioRun => {
  const scenarioRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-input-'));
  const scenarioPath = resolve(scenarioRoot, 'scenario.json');
  try {
    writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
    return runScenarioPath(scenarioPath, outputRoot);
  } finally {
    rmSync(scenarioRoot, { recursive: true, force: true });
  }
};

const allFiles = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();

describe('$create-lane native v2 producer', () => {
  it('creates an artifact lane with derived receipts and no redundant gate', () => {
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
      expect(allFiles(run.outputRoot)).toHaveLength(4);
      const ledger = parseRecord(readFileSync(ledgerPath, 'utf8'));
      expect(ledger['version']).toBe(2);
      expect(ledger['status']).toBe('ready');
      expect(ledger['confirmed_issues']).toEqual([4101]);
      expect(ledger).not.toHaveProperty('lane_plan_approval_sha256');
      expect(ledger['lanes']).toEqual([
        {
          name: 'runtime',
          queue: [4101],
          current_issue: 4101,
          status: 'queued',
          branch: null,
          worktree: null,
          pr: null,
          retry_count: 0,
        },
      ]);
      expect(
        execFileSync(process.execPath, [ledgerVerifier, ledgerPath], {
          encoding: 'utf8',
        }),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('publishes bulk issue numbers as canonical lane provenance', () => {
    // Given / When
    const run = runScenario('valid-number-intake.json');

    try {
      // Then
      expect(run.result).toEqual({
        status: 'ready',
        ledger: '.omo/lanes/lane-4101-runtime.json',
      });
      expect(allFiles(run.outputRoot)).toHaveLength(5);
      const artifact = parseRecord(
        readFileSync(
          resolve(
            run.outputRoot,
            '.omo/search-issue/artifacts/search-native-runtime.json',
          ),
          'utf8',
        ),
      );
      const ledger = parseRecord(
        readFileSync(
          resolve(run.outputRoot, '.omo/lanes/lane-4101-runtime.json'),
          'utf8',
        ),
      );
      expect(artifact['selected_issues']).toEqual([4101]);
      expect(ledger['source']).toEqual(
        expect.objectContaining({
          search_ledger:
            '.omo/search-issue/artifacts/search-native-runtime.json',
          artifact_id: artifact['artifact_id'],
          sha256: artifact['sha256'],
        }),
      );
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('publishes verbally collected issues as canonical lane provenance', () => {
    // Given / When
    const run = runScenario('valid-verbal-intake.json');

    try {
      // Then
      expect(run.result).toEqual({
        status: 'ready',
        ledger: '.omo/lanes/lane-4101-runtime.json',
      });
      expect(allFiles(run.outputRoot)).toHaveLength(5);
      const artifact = parseRecord(
        readFileSync(
          resolve(
            run.outputRoot,
            '.omo/search-issue/artifacts/search-native-runtime.json',
          ),
          'utf8',
        ),
      );
      expect(artifact).toEqual(
        expect.objectContaining({
          artifact_id: 'search:search-native-runtime',
          search_run_id: 'search-native-runtime',
          selected_issues: [4101],
        }),
      );
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      {
        mode: 'issue-numbers',
        issue_numbers: [],
        search_run_id: 'search-empty',
      },
      'invalid_issue_numbers',
    ],
    [
      {
        mode: 'issue-numbers',
        issue_numbers: [4101, 4101],
        search_run_id: 'search-duplicate',
      },
      'invalid_issue_numbers',
    ],
    [
      {
        mode: 'verbal',
        query: '',
        resolved_issue_numbers: [4101],
        search_run_id: 'search-unresolved',
      },
      'unresolved_verbal_input',
    ],
    [
      {
        mode: 'verbal',
        query: 'collect runtime issues',
        resolved_issue_numbers: [],
        search_run_id: 'search-unresolved',
      },
      'unresolved_verbal_input',
    ],
  ])('rejects malformed generated intake before publication', (intake, reason) => {
    const run = runScenarioValue({ intake });
    try {
      expect(run.result).toEqual({ status: 'rejected', reason });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('preserves a colliding generated artifact without publishing a lane', () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
    const artifact = resolve(
      outputRoot,
      '.omo/search-issue/artifacts/search-native-runtime.json',
    );
    mkdirSync(resolve(artifact, '..'), { recursive: true });
    writeFileSync(artifact, '{"existing":true}\n', 'utf8');

    const run = runScenario('valid-number-intake.json', outputRoot);
    try {
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'artifact_collision',
      });
      expect(readFileSync(artifact, 'utf8')).toBe('{"existing":true}\n');
      expect(allFiles(outputRoot)).toEqual([artifact]);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('retains generated provenance when the lane target collides', () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
    const target = resolve(outputRoot, '.omo/lanes/lane-4101-runtime.json');
    const artifact = resolve(
      outputRoot,
      '.omo/search-issue/artifacts/search-native-runtime.json',
    );
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, '{"existing":true}\n', 'utf8');

    const run = runScenario('valid-number-intake.json', outputRoot);
    try {
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'target_collision',
      });
      expect(readFileSync(target, 'utf8')).toBe('{"existing":true}\n');
      expect(parseRecord(readFileSync(artifact, 'utf8'))['selected_issues']).toEqual([
        4101,
      ]);
      expect(allFiles(outputRoot)).toEqual([artifact, target].sort());
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked generated output root before artifact publication', () => {
    const parent = mkdtempSync(resolve(tmpdir(), 'fluo-create-parent-'));
    const outside = mkdtempSync(resolve(tmpdir(), 'fluo-create-outside-'));
    const outputRoot = resolve(parent, 'redirected');
    symlinkSync(outside, outputRoot);

    const run = runScenario('valid-number-intake.json', outputRoot);
    try {
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'unsafe_output_path',
      });
      expect(allFiles(outside)).toEqual([]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects replayed approval IDs before creating another lane', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
    const first = runScenario('valid-native-artifact.json', outputRoot);

    try {
      // When
      const second = runScenario('valid-native-artifact.json', outputRoot);

      // Then
      expect(first.result['status']).toBe('ready');
      expect(second.result).toEqual({
        status: 'rejected',
        reason: 'approval_replayed',
      });
      expect(allFiles(outputRoot)).toHaveLength(4);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects a lane plan changed after approvals were issued', () => {
    // Given
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-native-artifact.json'), 'utf8'),
    );
    const plan = fixture['plan'];
    if (!isRecord(plan)) {
      throw new TypeError('valid fixture plan must be an object');
    }

    // When
    const run = runScenarioValue({
      ...fixture,
      plan: { ...plan, lane_id: 'lane-4101-substituted' },
    });

    try {
      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'approval_binding_mismatch',
      });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects reused approval IDs without writing any file', () => {
    // Given
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-native-artifact.json'), 'utf8'),
    );
    const approvals = fixture['approvals'];
    if (!Array.isArray(approvals) || !isRecord(approvals[0])) {
      throw new TypeError('valid fixture approvals must be objects');
    }
    const reused = approvals.map((approval, index) =>
      index === 1 && isRecord(approval)
        ? { ...approval, approval_id: approvals[0]['approval_id'] }
        : approval,
    );

    // When
    const run = runScenarioValue({ ...fixture, approvals: reused });

    try {
      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'approval_not_distinct',
      });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects a release handoff without an explicit release-core decision', () => {
    // Given
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-native-artifact.json'), 'utf8'),
    );
    const plan = fixture['plan'];
    if (!isRecord(plan)) {
      throw new TypeError('valid fixture plan must be an object');
    }

    // When
    const run = runScenarioValue({
      ...fixture,
      plan: { ...plan, release_handoffs: [4101] },
    });

    try {
      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'invalid_artifact',
      });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects a self-attested release handoff without issue evidence', () => {
    // Given
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-native-artifact.json'), 'utf8'),
    );
    const plan = fixture['plan'];
    if (!isRecord(plan)) {
      throw new TypeError('valid fixture plan must be an object');
    }

    // When
    const run = runScenarioValue({
      ...fixture,
      plan: {
        ...plan,
        release_handoffs: [
          {
            issue_number: 4101,
            reason: 'release-or-publish-is-core',
          },
        ],
      },
    });

    try {
      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'invalid_artifact',
      });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('publishes an evidence-bound release handoff and its attestation', () => {
    // Given / When
    const run = runScenario('valid-release-handoff.json');

    try {
      // Then
      const ledger = parseRecord(
        readFileSync(
          resolve(run.outputRoot, '.omo/lanes/lane-4101-runtime.json'),
          'utf8',
        ),
      );
      const receipt = parseRecord(
        readFileSync(
          resolve(
            run.outputRoot,
            '.omo/approvals/approval-lane-4101-runtime-lane-plan.json',
          ),
          'utf8',
        ),
      );
      expect(run.result).toEqual({
        status: 'ready',
        ledger: '.omo/lanes/lane-4101-runtime.json',
      });
      expect(ledger['release_handoffs']).toEqual([4101]);
      expect(ledger['lane_plan_approval_sha256']).toBe(
        receipt['binding_sha256'],
      );
      expect(receipt['release_handoff_attestations']).toEqual([
        {
          issue_number: 4101,
          issue_evidence_sha256: 'a'.repeat(64),
          decision: 'release-or-publish-is-core',
          changeset_only: false,
        },
      ]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it('executes a handoff from its exact producer receipt and artifact', () => {
    // Given
    const run = runScenario('valid-release-handoff.json');
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-release-e2e-'));
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-release-handoff.json'), 'utf8'),
    );
    const artifact = isRecord(fixture['artifacts'])
      ? fixture['artifacts'][
          '.omo/search-issue/artifacts/search-native-runtime.json'
        ]
      : undefined;
    const artifactPath = resolve(
      run.outputRoot,
      '.omo/search-issue/artifacts/search-native-runtime.json',
    );
    mkdirSync(resolve(run.outputRoot, '.omo/search-issue/artifacts'), {
      recursive: true,
    });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    );

    try {
      // When
      const result = parseRecord(
        execFileSync(
          process.execPath,
          [
            executeReplay,
            '--fixture-only',
            '--scenario',
            resolve(executeFixtureRoot, 'interrupted-start.json'),
            '--ledger',
            resolve(
              run.outputRoot,
              '.omo/lanes/lane-4101-runtime.json',
            ),
            '--state-dir',
            state,
            '--repository-root',
            run.outputRoot,
          ],
          { encoding: 'utf8' },
        ),
      );

      // Then
      expect(result['status']).toBe('blocked-maintainer-decision');
      expect(result['merge_count']).toBe(0);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('rejects a handoff without a matching lane-plan attestation', () => {
    // Given
    const fixture = parseRecord(
      readFileSync(resolve(fixtureRoot, 'valid-release-handoff.json'), 'utf8'),
    );
    const approvals = fixture['approvals'];
    if (!Array.isArray(approvals) || !isRecord(approvals[2])) {
      throw new TypeError('release handoff fixture approvals must be objects');
    }

    // When
    const run = runScenarioValue({
      ...fixture,
      approvals: approvals.map((approval, index) =>
        index === 2 && isRecord(approval)
          ? { ...approval, release_handoff_attestations: [] }
          : approval,
      ),
    });

    try {
      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'release_handoff_attestation_mismatch',
      });
      expect(allFiles(run.outputRoot)).toEqual([]);
    } finally {
      rmSync(run.outputRoot, { recursive: true, force: true });
    }
  });

  it.each([
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

  it('rejects a symlinked lane directory without writing outside the output root', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-'));
    const outsideRoot = mkdtempSync(resolve(tmpdir(), 'fluo-create-lane-outside-'));
    mkdirSync(resolve(outputRoot, '.omo'), { recursive: true });
    symlinkSync(outsideRoot, resolve(outputRoot, '.omo/lanes'), 'dir');

    try {
      // When
      const run = runScenario('valid-native-artifact.json', outputRoot);

      // Then
      expect(run.result).toEqual({
        status: 'rejected',
        reason: 'unsafe_output_path',
      });
      expect(allFiles(outsideRoot)).toEqual([]);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
