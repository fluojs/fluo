import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, hostname, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shoot, TrafficFailure, type TrafficOptions } from '../../src/traffic';
import { Issue3941Dependencies } from './dependencies';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function generatorIdentity(entry: string) {
  const directory = dirname(entry);
  const require = createRequire(import.meta.url);
  const autocannonManifest: { version: string } = JSON.parse(await readFile(require.resolve('autocannon/package.json'), 'utf8'));
  if (autocannonManifest.version !== '7.15.0') throw new TypeError('Unexpected generator autocannon version');
  if (process.env.NODE_OPTIONS || Object.keys(process.env).some((key) => key.startsWith('BENCH_'))
    || process.execArgv.some((arg) => /inspect|prof|trace|require|import/.test(arg))) {
    throw new TypeError('Generator instrumentation is forbidden');
  }
  return {
    protocol: 'issue3941-generator-v1', pid: process.pid, hostname: hostname(),
    node: process.version, executable: process.execPath, executableSha256: hash(await readFile(process.execPath)),
    osRelease: release(), cpus: cpus().map((cpu) => cpu.model),
    lockSha256: hash(await readFile(join(directory, 'pnpm-lock.yaml'))),
    installedLockSha256: hash(await readFile(join(directory, 'node_modules/.pnpm/lock.yaml'))),
    clientSha256: hash(await readFile(entry)), autocannon: autocannonManifest.version,
    dependenciesSha256: Issue3941Dependencies.digest(
      await Issue3941Dependencies.capture(entry, ['autocannon']), directory),
  };
}

async function main(): Promise<void> {
  const entry = fileURLToPath(import.meta.url);
  const generator = await generatorIdentity(entry);
  if (process.argv[2] === '--identity') {
    process.stdout.write(`${JSON.stringify(generator)}\n`);
    return;
  }
  const options: TrafficOptions = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
  try {
    const measurement = await shoot(options, 'issue3941-independent-generator');
    const after = await generatorIdentity(entry);
    if (JSON.stringify(generator) !== JSON.stringify(after)) throw new TypeError('Generator identity changed during traffic');
    process.stdout.write(JSON.stringify({ ...measurement, generator }));
  } catch (error) {
    if (!(error instanceof TrafficFailure)) throw error;
    process.stdout.write(JSON.stringify({ generator, failure: { message: error.message, diagnostics: error.diagnostics } }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
