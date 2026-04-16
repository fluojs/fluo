import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
