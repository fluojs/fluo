import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// One startup attestation, before the host starts. No HTTP interception, timers,
// inspector connection or profiler is installed in the measured process.
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = JSON.parse(process.env.BENCH_TIMING_FILES);
const hashes = {};
for (const file of files) hashes[file] = digest(await readFile(file));
const deno = Reflect.get(globalThis, 'Deno');
const bun = Reflect.get(globalThis, 'Bun');
const runtime = deno ? { ...deno.version } : { ...process.versions };
let inspectorUrl = null;
if (!deno && !bun) inspectorUrl = (await import('node:inspector')).url() ?? null;
const instrumentationFlags = [...process.execArgv, process.env.NODE_OPTIONS ?? '', process.env.DENO_JSC_FLAGS ?? '']
  .filter((flag) => /inspect|prof|trace-gc/i.test(flag));
const identity = {
  nonce: process.env.BENCH_TIMING_NONCE,
  target: process.env.BENCH_TARGET,
  pid: deno ? deno.pid : process.pid,
  runtime,
  executable: deno ? deno.execPath() : process.execPath,
  executableSha256: digest(await readFile(deno ? deno.execPath() : process.execPath)),
  entry: process.env.BENCH_TIMING_ENTRY,
  artifacts: hashes,
  artifactsSha256: digest(JSON.stringify(hashes)),
  inspectorUrl,
  instrumentationFlags,
};
process.stdout.write(`BENCH_TIMING_IDENTITY ${JSON.stringify(identity)}\n`);
if (process.env.BENCH_TIMING_IMPORT_ENTRY === '1') {
  await import(pathToFileURL(process.env.BENCH_TIMING_ENTRY).href);
}
