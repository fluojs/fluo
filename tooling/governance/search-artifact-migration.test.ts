import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { approvalBinding } from './search-artifact-migration-support';

const root = process.cwd();
const importerPath = resolve(
  root,
  '.agents/skills/search-issue/scripts/migrate-legacy-artifacts.mjs',
);
const createLaneFixture = resolve(
  root,
  '.agents/skills/create-lane/scripts/fixtures/run-scenario.mjs',
);
const ledgerVerifier = resolve(
  root,
  'tooling/governance/verify-lane-ledger.mjs',
);

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

const runImporter = (
  source: string,
  target: string,
): Readonly<Record<string, unknown>> =>
  parseRecord(
    execFileSync(
      process.execPath,
      [
        importerPath,
        '--source',
        source,
        '--target',
        target,
        '--migrated-at',
        '2026-08-24T00:00:00.000Z',
      ],
      { encoding: 'utf8' },
    ),
  );

const createLegacyFixture = (outputRoot: string) => {
  const source = resolve(outputRoot, 'source');
  mkdirSync(source);
  const artifacts = Array.from({ length: 9 }, (_, index) => {
    const runId = index === 0
      ? 'search-2026-08-23T235415+0900-runtime'
      : `search-fixture-${index}`;
    const issues = [index + 11, index + 1];
    const filename = `${runId}.json`;
    const bytes = `${JSON.stringify({
      version: 1, search_run_id: runId, selected_issues: issues,
    }, null, 2)}\n`;
    writeFileSync(resolve(source, filename), bytes);
    const identity = {
      version: 2, artifact_id: `search:${runId}`,
      search_run_id: runId, selected_issues: issues,
    };
    const sha256 = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return {
      filename,
      source_sha256: createHash('sha256').update(bytes).digest('hex'),
      target_artifact_id: identity.artifact_id,
      target_sha256: sha256,
    };
  }).sort((left, right) => left.filename.localeCompare(right.filename));
  return {
    source,
    receipt: {
      version: 1, migrated_at: '2026-08-24T00:00:00.000Z',
      source_root: '.opencode-backup/search-issue',
      target_root: '.omo/search-issue/artifacts/legacy',
      artifacts,
    },
  };
};

describe('legacy search artifact migration', () => {
  it('reconstructs nine canonical v2 artifacts and the expected checksum receipt', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-search-migration-'));
    const fixture = createLegacyFixture(outputRoot);
    const target = resolve(
      outputRoot,
      '.omo/search-issue/artifacts/legacy',
    );

    try {
      // When
      const first = runImporter(fixture.source, target);
      const second = runImporter(fixture.source, target);

      // Then
      expect(first).toEqual(second);
      expect(first).toEqual({
        status: 'migrated',
        artifact_count: 9,
        receipt: '.omo/search-issue/artifacts/legacy/migration-receipt.json',
      });
      expect(readdirSync(target).sort()).toHaveLength(10);
      expect(
        parseRecord(readFileSync(resolve(target, 'migration-receipt.json'), 'utf8')),
      ).toEqual(fixture.receipt);
      for (const artifact of fixture.receipt.artifacts) {
        const legacy = parseRecord(readFileSync(resolve(fixture.source, artifact.filename), 'utf8'));
        const migrated = parseRecord(readFileSync(resolve(target, artifact.filename), 'utf8'));
        expect(migrated).toEqual({
          version: 2,
          artifact_id: artifact.target_artifact_id,
          sha256: artifact.target_sha256,
          search_run_id: legacy['search_run_id'],
          selected_issues: legacy['selected_issues'],
        });
      }
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when an existing migrated artifact has different bytes', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-search-migration-'));
    const { source } = createLegacyFixture(outputRoot);
    const target = resolve(outputRoot, 'target');
    runImporter(source, target);
    const firstArtifact = readdirSync(target)
      .filter((name) => name !== 'migration-receipt.json')
      .sort()[0];
    if (firstArtifact === undefined) {
      throw new TypeError('Expected one migrated artifact.');
    }
    writeFileSync(resolve(target, firstArtifact), '{"tampered":true}\n', 'utf8');

    try {
      // When / Then
      expect(() => runImporter(source, target)).toThrow();
      expect(readFileSync(resolve(target, firstArtifact), 'utf8')).toBe(
        '{"tampered":true}\n',
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('feeds an imported legacy artifact into create-lane', () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-search-migration-'));
    const { source } = createLegacyFixture(outputRoot);
    const target = resolve(outputRoot, '.omo/search-issue/artifacts/legacy');
    const createOutput = resolve(outputRoot, 'create-output');
    const scenarioPath = resolve(outputRoot, 'create-scenario.json');

    try {
      runImporter(source, target);
      const artifactName =
        'search-2026-08-23T235415+0900-runtime.json';
      const artifact = parseRecord(
        readFileSync(resolve(target, artifactName), 'utf8'),
      );
      const issues = artifact['selected_issues'];
      if (!Array.isArray(issues)) {
        throw new TypeError('Expected imported selected issues.');
      }
      const input = `.omo/search-issue/artifacts/legacy/${artifactName}`;
      const plan = {
        version: 2,
        lane_id: 'lane-legacy-runtime',
        base_branch: 'main',
        source: {
          artifact_id: artifact['artifact_id'],
          sha256: artifact['sha256'],
        },
        merge_policy: 'supervisor-auto',
        pr_merge_method: 'squash',
        authority_scope: {
          issue_creation: false,
          pr_creation: true,
          pr_merge: true,
          publish_via_github_actions: false,
          cleanup_command_worktrees: true,
          root_main_sync_ff_only: true,
        },
        retry_policy: {
          retry_count_is_terminal: true,
          max_same_failure_repeats: 3,
          max_wall_clock_minutes: 180,
          stop_on_child_contract_error: true,
        },
        confirmed_issues: issues,
        suggested_but_excluded: [],
        backlog_candidates: [],
        release_handoffs: [],
        lanes: [{ name: 'runtime', queue: issues }],
        dependency_graph: {},
      };
      const approvals = [
        {
          gate: 'confirmed-issues',
          approval_id: 'approval-lane-legacy-runtime-confirmed-issues',
          approved: true,
          issue_numbers: issues,
        },
        {
          gate: 'suggested-additions',
          approval_id: 'approval-lane-legacy-runtime-suggested-additions',
          approved: true,
          issue_numbers: [],
        },
        {
          gate: 'lane-plan',
          approval_id: 'approval-lane-legacy-runtime-lane-plan',
          approved: true,
          release_handoff_attestations: [],
        },
      ].map((approval) => ({
        ...approval,
        binding_sha256: approvalBinding(approval, artifact, plan),
      }));
      writeFileSync(
        scenarioPath,
        `${JSON.stringify(
          {
            intake: { mode: 'artifact', artifact_path: input },
            artifacts: { [input]: artifact },
            approvals,
            recommended_issue_numbers: [],
            plan,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const result = parseRecord(
        execFileSync(
          process.execPath,
          [
            createLaneFixture,
            '--fixture-only',
            '--scenario',
            scenarioPath,
            '--out',
            createOutput,
          ],
          { encoding: 'utf8' },
        ),
      );
      expect(result).toEqual({
        status: 'ready',
        ledger: '.omo/lanes/lane-legacy-runtime.json',
      });
      const ledgerPath = resolve(
        createOutput,
        '.omo/lanes/lane-legacy-runtime.json',
      );
      const ledger = parseRecord(readFileSync(ledgerPath, 'utf8'));
      expect(
        (ledger['source'] as Readonly<Record<string, unknown>>)[
          'search_ledger'
        ],
      ).toBe(input);
      expect(
        execFileSync(process.execPath, [ledgerVerifier, ledgerPath], {
          encoding: 'utf8',
        }),
      ).toContain('Lane ledger check passed for 1 file(s).');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
