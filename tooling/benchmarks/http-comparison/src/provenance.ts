import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { WDIR } from './targets';

const execute = promisify(execFile);
export const WORKSPACE_ROOT = join(WDIR, '../../..');
const require = createRequire(import.meta.url);

export function assertInstalledLockfile(expected: string, installed: string): void {
  if (expected !== installed) {
    throw new Error('Installed dependency lockfile differs from the declared lockfile; rerun frozen install before measuring');
  }
}

async function sourceSnapshot(directory: string, prefix = ''): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = {};
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (['node_modules', 'dist', '.next', '.wrangler', 'results'].includes(entry.name)) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await sourceSnapshot(join(directory, entry.name), `${name}/`));
    else if (entry.isFile() && (/\.(?:ts|mts|tsx|mjs|yaml)$/.test(entry.name)
      || /^(?:package|tsconfig(?:\.[\w-]+)?|wrangler)\.json$/.test(entry.name))) {
      files[name] = await readFile(join(directory, entry.name), 'utf8');
    }
  }
  return files;
}

async function installedPackage(name: string, resolver = require): Promise<{ readonly version: string; readonly path: string }> {
  let directory = resolver === require
    ? await realpath(join(WDIR, 'node_modules', name))
    : dirname(resolver.resolve(name));
  // Packages need not export package.json. Walk from the actual resolved entry.
  while (directory !== dirname(directory)) {
    try {
      const manifest: { name?: string; version?: string } = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name && typeof manifest.version === 'string') return { version: manifest.version, path: directory };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot find installed manifest for ${name}`);
}

export async function environmentSummary() {
  for (const directory of [WORKSPACE_ROOT, WDIR]) {
    assertInstalledLockfile(
      await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'),
      await readFile(join(directory, 'node_modules/.pnpm/lock.yaml'), 'utf8'),
    );
  }
  const manifest: { dependencies: Record<string, string>; devDependencies: Record<string, string> } = JSON.parse(await readFile(join(WDIR, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(await Promise.all(
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).map(async (name) => [name, await installedPackage(name)] as const),
  ));
  const adapterFastify = Object.fromEntries(await Promise.all(
    ['@nestjs/platform-fastify', '@fluojs/platform-fastify'].map(async (name) => [name, await installedPackage('fastify', createRequire(join(dependencies[name].path, 'package.json')))] as const),
  ));
  const adapterExpress = Object.fromEntries(await Promise.all(
    ['@nestjs/platform-express', '@fluojs/platform-express'].map(async (name) => [name, await installedPackage('express', createRequire(join(dependencies[name].path, 'package.json')))] as const),
  ));
  for (const [engine, resolutions] of Object.entries({ fastify: adapterFastify, express: adapterExpress })) {
    const versions = new Set([dependencies[engine].version, ...Object.values(resolutions).map((item) => item.version)]);
    if (versions.size !== 1) throw new Error(`${engine} host engine versions differ: ${JSON.stringify(resolutions)}`);
  }
  let bun: string | null;
  try { bun = (await execute('bun', ['--version'])).stdout.trim(); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    bun = null;
  }
  let deno: string | null;
  try { deno = (await execute('deno', ['--version'])).stdout.trim(); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    deno = null;
  }
  const gitSha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: WORKSPACE_ROOT })).stdout.trim();
  const gitStatus = (await execute('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: WORKSPACE_ROOT })).stdout;
  const source = await sourceSnapshot(WDIR);
  const sourceSha256 = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  const lockfiles = Object.fromEntries(await Promise.all(
    [join(WORKSPACE_ROOT, 'pnpm-lock.yaml'), join(WDIR, 'pnpm-lock.yaml')].map(async (path) => [path, createHash('sha256').update(await readFile(path)).digest('hex')] as const),
  ));
  return {
    capturedAt: new Date().toISOString(), arch: arch(), platform: platform(), osRelease: release(),
    cpuModel: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length,
    node: process.version, nodeExecutable: process.execPath, bun,
    deno,
    pnpm: (await execute('pnpm', ['--version'])).stdout.trim(),
    dependencies, adapterFastify, adapterExpress, lockfiles,
    git: { sha: gitSha, dirty: gitStatus.length > 0, status: gitStatus },
    benchmarkSource: { sha256: sourceSha256, files: source },
  };
}

export type EnvironmentSummary = Awaited<ReturnType<typeof environmentSummary>>;
