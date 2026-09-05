import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FLUO_VITEST_SHUTDOWN_DEBUG_DIR_ENV,
  FLUO_VITEST_SHUTDOWN_DEBUG_ENV,
  isFluoVitestShutdownDebugEnabled,
  resolveFluoVitestShutdownDebugDirectory,
  writeVitestShutdownDebugSnapshot,
} from './shutdown-debug.js';
import {
  resolveWorkerActivityFilePath,
  resolveWorkerActivitySuiteName,
  resolveWorkerActivityTestName,
} from './shutdown-debug.setup.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const vitestEntrypoint = join(repoRoot, 'node_modules/vitest/vitest.mjs');

describe('shutdown debug helpers', () => {
  it('treats the attribution path as opt-in', () => {
    expect(isFluoVitestShutdownDebugEnabled({ [FLUO_VITEST_SHUTDOWN_DEBUG_ENV]: '1' })).toBe(true);
    expect(isFluoVitestShutdownDebugEnabled({ [FLUO_VITEST_SHUTDOWN_DEBUG_ENV]: 'true' })).toBe(true);
    expect(isFluoVitestShutdownDebugEnabled({ [FLUO_VITEST_SHUTDOWN_DEBUG_ENV]: '0' })).toBe(false);
    expect(isFluoVitestShutdownDebugEnabled({})).toBe(false);
  });

  it('resolves the debug directory from the environment when present', () => {
    expect(
      resolveFluoVitestShutdownDebugDirectory('/repo/root', {
        [FLUO_VITEST_SHUTDOWN_DEBUG_DIR_ENV]: 'custom/debug-dir',
      }),
    ).toBe('custom/debug-dir');
  });

  it('writes structured current-run evidence snapshots', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'fluo-vitest-shutdown-debug-'));
    const filePath = writeVitestShutdownDebugSnapshot(
      repoRoot,
      'run-end',
      {
        kind: 'run-end',
        reason: 'failed',
      },
      {},
    );

    const written = JSON.parse(readFileSync(filePath, 'utf8')) as {
      kind: string;
      reason: string;
      schemaVersion: number;
    };

    expect(written).toEqual({
      kind: 'run-end',
      reason: 'failed',
      schemaVersion: 1,
    });
  });

  it('tolerates missing hook metadata when deriving worker activity', () => {
    expect(resolveWorkerActivitySuiteName(undefined)).toBeNull();
    expect(resolveWorkerActivitySuiteName({})).toBeNull();
    expect(resolveWorkerActivityTestName(undefined)).toBeNull();
    expect(resolveWorkerActivityTestName({})).toBeNull();
    expect(resolveWorkerActivityFilePath(undefined)).toBe('[unknown-file]');
    expect(resolveWorkerActivityFilePath({})).toBe('[unknown-file]');
  });

  it('prefers available suite and task paths when metadata exists', () => {
    expect(
      resolveWorkerActivityFilePath({
        filepath: '/repo/root/tooling/vitest/src/example.test.ts',
      }),
    ).toContain('tooling/vitest/src/example.test.ts');
    expect(
      resolveWorkerActivityFilePath({
        task: {
          file: {
            filepath: '/repo/root/packages/runtime/src/application.test.ts',
          },
          name: 'example test',
        },
      }),
    ).toContain('packages/runtime/src/application.test.ts');
    expect(resolveWorkerActivitySuiteName({ name: 'example suite' })).toBe('example suite');
    expect(resolveWorkerActivityTestName({ task: { name: 'example test' } })).toBe('example test');
  });
});

describe('shutdown debug hooks in Vitest', () => {
  it.each([false, true])('preserves activity and artifacts with a real worker (failing=%s)', (failing) => {
    // Given a real workspace config and an isolated worker with all four lifecycle hooks.
    const fixtureRoot = mkdtempSync(join(repoRoot, '.vitest-shutdown-debug-'));
    const workerPath = join(fixtureRoot, 'worker.test.ts');
    const configPath = join(fixtureRoot, 'vitest.config.mjs');
    const activityPath = join(fixtureRoot, 'activity.jsonl');
    const resultPath = join(fixtureRoot, 'result.json');
    const debugDirectory = join(fixtureRoot, 'diagnostics');
    const workerFile = relative(repoRoot, workerPath);
    const testName = 'executes the debug fixture';

    try {
      writeFileSync(
        configPath,
        [
          `import { createFluoVitestWorkspaceConfig } from ${JSON.stringify(join(repoRoot, 'tooling/vitest/src/index.ts'))};`,
          `export default createFluoVitestWorkspaceConfig(new URL(${JSON.stringify(pathToFileURL(repoRoot).href)}), {`,
          '  test: {',
          "    name: 'shutdown-debug-fixture',",
          `    include: [${JSON.stringify(workerPath)}],`,
          `    reporters: [['json', { outputFile: ${JSON.stringify(resultPath)} }]],`,
          "    sequence: { hooks: 'list' },",
          '  },',
          '});',
        ].join('\n'),
      );
      writeFileSync(
        workerPath,
        [
          "import { appendFileSync } from 'node:fs';",
          "import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';",
          'const recordActivity = () => {',
          "  const activity = globalThis[Symbol.for('fluo.vitest.shutdownDebugState')].lastActivity;",
          `  appendFileSync(${JSON.stringify(activityPath)}, JSON.stringify(activity) + '\\n');`,
          '};',
          'beforeAll(recordActivity);',
          'beforeEach(recordActivity);',
          'afterEach(recordActivity);',
          'afterAll(recordActivity);',
          `it(${JSON.stringify(testName)}, () => { expect(${String(failing)}).toBe(false); });`,
        ].join('\n'),
      );

      // When Vitest runs with the same opt-in diagnostics used by CI.
      const result = spawnSync(process.execPath, [vitestEntrypoint, 'run', '--config', configPath, '--maxWorkers=1'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          [FLUO_VITEST_SHUTDOWN_DEBUG_ENV]: '1',
          [FLUO_VITEST_SHUTDOWN_DEBUG_DIR_ENV]: debugDirectory,
        },
        timeout: 60_000,
      });

      // Then the test body executes, every hook attributes its activity, and failures retain diagnostics.
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(failing ? 1 : 0);
      const report: unknown = JSON.parse(readFileSync(resultPath, 'utf8'));
      expect(report, result.stderr).toMatchObject({
        numTotalTests: 1,
        numPassedTests: failing ? 0 : 1,
        numFailedTests: failing ? 1 : 0,
        numPendingTests: 0,
      });
      const activities: unknown[] = readFileSync(activityPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(activities).toEqual(
        ['beforeAll', 'beforeEach', 'afterEach', 'afterAll'].map((phase) => ({
          at: expect.any(String),
          file: workerFile,
          phase,
          suite: workerFile,
          test: phase === 'beforeEach' || phase === 'afterEach' ? testName : null,
        })),
      );
      const artifactPath = join(debugDirectory, 'run-end.json');
      expect(existsSync(artifactPath)).toBe(failing);
      if (failing) {
        const artifact: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'));
        expect(artifact).toMatchObject({
          schemaVersion: 1,
          kind: 'run-end',
          reason: 'failed',
          runStartedAt: expect.any(String),
          finishedAt: expect.any(String),
          testModules: [{ moduleId: workerFile, projectName: 'shutdown-debug-fixture', state: 'failed', ok: false }],
          unhandledErrors: [],
          process: {
            activeHandles: { count: expect.any(Number), types: expect.any(Array) },
            activeRequests: { count: expect.any(Number), types: expect.any(Array) },
          },
        });
      }
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }, 60_000);
});
