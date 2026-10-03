import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('terminating a benchmark owner also terminates its detached server', { timeout: 10_000 }, async () => {
  // Given: a real detached server owned by a separate benchmark process.
  const owner = spawn(process.execPath, [
    '--import', 'tsx', fileURLToPath(new URL('./fixtures/target-owner.mts', import.meta.url)),
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = once(owner, 'close');
  let serverPid: number | undefined;
  try {
    const [output] = await once(owner.stdout, 'data');
    serverPid = JSON.parse(String(output)).serverPid;
    assert.equal(typeof serverPid, 'number');
    // When: subscribe to completion before triggering the shutdown.
    owner.kill('SIGTERM');
    const [code] = await closed;
    // Then: completion cannot leave the listening server behind.
    assert.equal(code, 143);
    assert.throws(() => process.kill(serverPid ?? 0, 0), { code: 'ESRCH' });
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    if (serverPid !== undefined) {
      try { process.kill(-serverPid, 'SIGKILL'); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
  }
});
