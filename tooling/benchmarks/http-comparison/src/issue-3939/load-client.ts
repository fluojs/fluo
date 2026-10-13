import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { shoot, TrafficFailure, type TrafficOptions } from '../traffic';

// The lead stages this issue-owned entry beside the established generator install.
const options: TrafficOptions = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
try {
  const generator = {
    pid: process.pid, hostname: hostname(), nodeVersion: process.version,
    os: release(), nodeExecutable: process.execPath,
    nodeExecutableSha256: sha256(await readFile(process.execPath)),
    lockfileSha256: sha256(await readFile('pnpm-lock.yaml')),
    clientEntrySha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  };
  const measurement = await shoot(options, 'issue-3939-remote-load');
  process.stdout.write(JSON.stringify({ ...measurement, generator }));
} catch (error) {
  if (!(error instanceof Error)) throw error;
  process.stdout.write(JSON.stringify({ failure: {
    name: error.name, message: error.message,
    ...(error instanceof TrafficFailure ? { diagnostics: error.diagnostics } : {}),
  } }));
  process.exitCode = 1;
}
