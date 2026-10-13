import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus, hostname, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { shoot, TrafficFailure, type TrafficOptions } from '../traffic.js';

// This bundled entry is deployed with its exact benchmark lock beside it.
// Observe the files actually executed, never hashes supplied in environment variables.
const digest = async (path: string | URL) => createHash('sha256').update(await readFile(path)).digest('hex');
const generator = {
  pid: process.pid, hostname: hostname(), node: process.version,
  executable: process.execPath, osRelease: release(), cpus: cpus().map((cpu) => cpu.model),
  entryPath: fileURLToPath(import.meta.url),
  entrySha256: await digest(fileURLToPath(import.meta.url)),
  nodeExecutableSha256: await digest(process.execPath),
  lockfileSha256: await digest(new URL('./pnpm-lock.yaml', import.meta.url)),
};

if (process.argv[2] === '--identity') {
  process.stdout.write(JSON.stringify({ generator }));
} else {
  const options: TrafficOptions = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
  try {
    const measurement = await shoot(options, 'issue-3942-remote-load-client');
    process.stdout.write(JSON.stringify({ ...measurement, generator }));
  } catch (error) {
    if (!(error instanceof TrafficFailure)) throw error;
    process.stdout.write(JSON.stringify({ generator, failure: { message: error.message, diagnostics: error.diagnostics } }));
    process.exitCode = 1;
  }
}
