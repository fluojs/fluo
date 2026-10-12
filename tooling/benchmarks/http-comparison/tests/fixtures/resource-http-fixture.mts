import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export async function withResourceHttpServer<T>(
  mode: 'success' | 'failure',
  check: (subject: { pid: number; url: string }) => Promise<T>,
): Promise<T> {
  const child = fork(fileURLToPath(new URL('./resource-http-server.mjs', import.meta.url)), [mode], {
    execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const closed = once(child, 'close', { signal: AbortSignal.timeout(10_000) });
  const ready = once(child, 'message', { signal: AbortSignal.timeout(5_000) });
  try {
    const pid = child.pid;
    assert.ok(pid);
    assert.notEqual(pid, process.pid, 'The serving subject must be separate from the sampler');
    child.send('listen');
    const [address] = await ready;
    assert.ok(address && typeof address === 'object' && typeof address.port === 'number');
    return await check({ pid, url: `http://127.0.0.1:${address.port}` });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  }
}
