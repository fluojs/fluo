import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Measurement, shoot, type TrafficOptions } from './traffic';

const execute = promisify(execFile);

export async function load(options: TrafficOptions, label: string): Promise<Measurement> {
  const host = process.env.BENCH_SSH_HOST;
  if (host === undefined) {
    if (process.env.BENCH_LOAD_PROCESS !== '1') return shoot(options, label);
    const payload = Buffer.from(JSON.stringify(options)).toString('base64');
    const result = await execute(process.execPath, [
      fileURLToPath(new URL('../dist/load-client.mjs', import.meta.url)), payload,
    ], { maxBuffer: 64 * 1024 * 1024, timeout: (options.duration + 120) * 1000 });
    return JSON.parse(result.stdout);
  }
  const directory = process.env.BENCH_REMOTE_DIR;
  if (!directory || !/^\/[A-Za-z0-9/_.-]+$/.test(directory)) {
    throw new Error('BENCH_REMOTE_DIR must be an absolute remote directory without shell metacharacters');
  }
  const payload = Buffer.from(JSON.stringify(options)).toString('base64');
  const command = `cd ${directory} && PATH=/usr/local/bin:$PATH node load-client.mjs ${payload}`;
  const control = process.env.BENCH_SSH_CONTROL;
  const result = await execute('ssh', [
    '-o', 'BatchMode=yes',
    ...(control ? ['-S', control] : []),
    host, command,
  ], { maxBuffer: 64 * 1024 * 1024, timeout: (options.duration + 120) * 1000 });
  return JSON.parse(result.stdout);
}
