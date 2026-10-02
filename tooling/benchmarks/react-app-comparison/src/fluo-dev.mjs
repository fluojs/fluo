import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { stopOwnedProcess } from './process-group.mjs';

const app = resolve(import.meta.dirname, '../apps/fluo');
const cli = resolve(app, '../../../../../packages/cli/bin/fluo.mjs');
const child = spawn(process.execPath, [cli, 'dev', '--runner', 'fluo'], {
  cwd: app,
  env: { ...process.env, NODE_ENV: 'development', PORT: process.env.PORT ?? '32151' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let stopping;
function shutdown() {
  stopping ??= stopOwnedProcess(child, { group: false, termMs: 10_000 });
  return stopping;
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
const [code, signal] = await once(child, 'exit');
await stopping;
process.exitCode = code ?? (signal ? 1 : 0);
