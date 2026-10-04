import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/evidence-owner.mts', import.meta.url));
for (const mode of ['failure', 'signal', 'signal-after-complete']) {
  test(`preserves completed HTTP samples and rejects ${mode} evidence`, { timeout: 15_000 }, async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), 'fluo-evidence-'));
    const output = join(directory, 'baseline-default.json');
    const child = spawn(process.execPath, ['--import', 'tsx', fixture, output, mode], { stdio: ['ignore', 'pipe', 'inherit'] });
    const closed = once(child, 'close');
    try {
      // When: signal subscription precedes the action; no polling or sleeps.
      if (mode !== 'failure') {
        await once(child.stdout, 'data');
        child.kill('SIGTERM');
      }
      const [code] = await closed;
      // Then
      assert.equal(code, mode === 'failure' ? 1 : 143);
      const evidence = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(evidence.completed.length, 1);
      assert.ok(evidence.completed[0].result.requests.total > 0);
      assert.equal(evidence.invalidAttempts.length, 1);
      assert.equal(evidence.invalidAttempts[0].condition.target, mode === 'signal-after-complete' ? 'good' : 'bad');
      if (mode === 'failure') {
        assert.ok(evidence.invalidAttempts[0].error.traffic.result.non2xx > 0);
        assert.ok(evidence.invalidAttempts[0].error.traffic.clientCpu.wallMicros > 0);
      } else {
        assert.equal(evidence.invalidAttempts[0].phase, 'interrupted');
      }
      await assert.rejects(execute(process.execPath, [
        '--import', 'tsx', fileURLToPath(new URL('../src/archive.mjs', import.meta.url)), directory,
      ]), /invalidAttempts/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await rm(directory, { recursive: true, force: true });
    }
  });
}
