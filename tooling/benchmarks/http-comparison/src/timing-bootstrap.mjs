import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import process from 'node:process';

// One startup attestation, before the host starts. No HTTP interception, timers,
// inspector connection or profiler is installed in the measured process.
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashBuffer = Buffer.allocUnsafe(64 * 1024);
function digestFile(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    for (let bytes = readSync(fd, hashBuffer); bytes > 0; bytes = readSync(fd, hashBuffer)) {
      hash.update(hashBuffer.subarray(0, bytes));
    }
  } finally { closeSync(fd); }
  return hash.digest('hex');
}
const files = JSON.parse(process.env.BENCH_TIMING_FILES);
const hashes = {};
for (const file of files) hashes[file] = digestFile(file);
const bun = Reflect.get(globalThis, 'Bun');
const runtime = { ...process.versions };
let inspectorUrl = null;
if (!bun) inspectorUrl = (await import('node:inspector')).url() ?? null;
const instrumentationFlags = [...process.execArgv, process.env.NODE_OPTIONS ?? '']
  .filter((flag) => /inspect|prof|trace-gc/i.test(flag));
const identity = {
  nonce: process.env.BENCH_TIMING_NONCE,
  target: process.env.BENCH_TARGET,
  pid: process.pid,
  runtime,
  executable: process.execPath,
  executableSha256: digestFile(process.execPath),
  entry: process.env.BENCH_TIMING_ENTRY,
  artifacts: hashes,
  artifactsSha256: digest(JSON.stringify(hashes)),
  inspectorUrl,
  instrumentationFlags,
};
process.stdout.write(`BENCH_TIMING_IDENTITY ${JSON.stringify(identity)}\n`);
