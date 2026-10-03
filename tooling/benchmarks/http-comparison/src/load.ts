import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Measurement, shoot, type TrafficOptions } from './traffic';

const execute = promisify(execFile);

export class LoadProcessFailure extends Error {
  constructor(cause: Error, readonly stdout: string, readonly stderr: string) {
    super(cause.message, { cause });
    this.name = 'LoadProcessFailure';
  }
}

async function executeLoad(command: string, args: string[], timeout: number): Promise<Measurement> {
  try {
    const result = await execute(command, args, { maxBuffer: 64 * 1024 * 1024, timeout });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new LoadProcessFailure(error,
      'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
      'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '');
  }
}

export async function load(options: TrafficOptions, label: string): Promise<Measurement> {
  const host = process.env.BENCH_SSH_HOST;
  if (host === undefined) {
    if (process.env.BENCH_LOAD_PROCESS !== '1') return shoot(options, label);
    const payload = Buffer.from(JSON.stringify(options)).toString('base64');
    return executeLoad(process.execPath, [
      fileURLToPath(new URL('../dist/load-client.mjs', import.meta.url)), payload,
    ], (options.duration + 120) * 1000);
  }
  const directory = process.env.BENCH_REMOTE_DIR;
  if (!directory || !/^\/[A-Za-z0-9/_.-]+$/.test(directory)) {
    throw new Error('BENCH_REMOTE_DIR must be an absolute remote directory without shell metacharacters');
  }
  const payload = Buffer.from(JSON.stringify(options)).toString('base64');
  const command = `cd ${directory} && PATH=/usr/local/bin:$PATH node load-client.mjs ${payload}`;
  const control = process.env.BENCH_SSH_CONTROL;
  return executeLoad('ssh', [
    '-o', 'BatchMode=yes',
    ...(control ? ['-S', control] : []),
    host, command,
  ], (options.duration + 120) * 1000);
}
