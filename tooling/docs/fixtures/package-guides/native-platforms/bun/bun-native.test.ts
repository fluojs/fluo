import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bounded, spawnRuntimeApp } from '../support/child-runtime';

const appPath = fileURLToPath(new URL('./bun-server-app.ts', import.meta.url));

describe('native Bun composition', () => {
  it('serves a real Bun.serve listener, answers HTTP, and drains gracefully on SIGTERM', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'fluo-bun-fixture-'));
    const sentinelPath = join(scratch, 'shutdown-sentinel.txt');
    const handle = spawnRuntimeApp('bun', [appPath, sentinelPath]);

    try {
      const url = await bounded(handle.listening, 'bun listening sentinel');

      const response = await fetch(`${url}/health/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', runtime: 'bun' });

      handle.child.kill('SIGTERM');

      const exit = await handle.exited;
      expect(exit.code).toBe(0);

      // Written by OnApplicationShutdown inside the child: proves the DI
      // lifecycle teardown ran through the signal-driven close.
      expect(await readFile(sentinelPath, 'utf8')).toBe('shutdown signal=SIGTERM');
    } finally {
      if (!handle.child.killed && handle.child.exitCode === null) {
        handle.child.kill('SIGKILL');
      }
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});
