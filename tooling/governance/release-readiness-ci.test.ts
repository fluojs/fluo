import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, it } from 'vitest';

it('runs full same-commit release readiness before the stable lane gate and Changesets action', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8');

  // When
  const readinessStep = workflow.indexOf('      - name: Verify release readiness');
  const stableLaneGate = workflow.indexOf('      - name: Verify changeset release lane');
  const changesetsAction = workflow.indexOf('      - name: Create Release Pull Request or Publish to npm');

  // Then
  const buildStep = workflow.indexOf('      - name: Build packages');
  const bunStep = workflow.indexOf('      - name: Verify Bun native routing and lifecycle');
  expect(buildStep).toBeGreaterThanOrEqual(0);
  expect(buildStep).toBeLessThan(bunStep);
  expect(bunStep).toBeLessThan(readinessStep);
  expect(workflow.match(/run: pnpm build\s*$/gm)).toHaveLength(1);
  expect(workflow.slice(buildStep, bunStep)).toContain('run: pnpm build');
  expect(workflow.slice(readinessStep, stableLaneGate)).toContain('run: pnpm verify:release-readiness --skip-build');
  expect(workflow).not.toMatch(/continue-on-error:|if:|cancel-in-progress: true/u);
  expect(workflow).toMatch(/^concurrency: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}$/mu);
  expect(readinessStep).toBeGreaterThanOrEqual(0);
  expect(workflow.slice(readinessStep, stableLaneGate)).toContain('run: pnpm verify:release-readiness');
  expect(readinessStep).toBeLessThan(stableLaneGate);
  expect(stableLaneGate).toBeLessThan(changesetsAction);
});

it('accepts the CI build-reuse option through the real readiness CLI', () => {
  // Given
  const directory = mkdtempSync(join(tmpdir(), 'fluo-release-readiness-ci-'));
  const trace = join(directory, 'commands.jsonl');
  try {
    // Replace only external verification commands; exercise the real CLI parser,
    // child-process runner, and repository metadata checks without touching dist.
    writeFileSync(join(directory, 'pnpm'), [
      `#!${process.execPath}`,
      `require('node:fs').appendFileSync(process.env.RELEASE_COMMAND_TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    ].join('\n'), { mode: 0o755 });

    // When
    const result = spawnSync(process.execPath, [
      resolve(import.meta.dirname, '../release/verify-release-readiness.mjs'),
      '--skip-build',
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RELEASE_COMMAND_TRACE: trace },
      timeout: 10_000,
    });

    // Then
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      ['typecheck'],
      ['vitest', 'run', '--project', 'packages', '--maxWorkers=1'],
      ['vitest', 'run', '--project', 'apps', '--maxWorkers=1'],
      ['vitest', 'run', '--project', 'examples', '--maxWorkers=1'],
      ['vitest', 'run', '--project', 'tooling', '--maxWorkers=1'],
      ['--dir', 'packages/cli', 'sandbox:matrix'],
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
