import { fork } from 'node:child_process';
import { writeSync } from 'node:fs';
import { createServer } from 'node:net';

if (process.argv[2] === 'descendant') {
  process.on('SIGTERM', () => {});
  createServer().listen(0, '127.0.0.1', () => process.send({ ready: true }));
} else {
  const mode = process.argv[2];
  const descendant = fork(new URL(import.meta.url), ['descendant'], {
    detached: mode === 'escaped',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  descendant.once('message', () => {
    process.stdout.write(`${JSON.stringify({ descendantPid: descendant.pid, ready: 'listening on :0' })}\n`);
    if (mode === 'exited' || mode === 'escaped') process.exit(0);
  });
  process.once('SIGTERM', () => {
    writeSync(1, 'stdout-terminal\n');
    writeSync(2, 'stderr-terminal\n');
    process.exit(0);
  });
}
