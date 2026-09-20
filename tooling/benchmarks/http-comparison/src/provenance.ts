import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { WDIR } from './targets';

const execute = promisify(execFile);
export const WORKSPACE_ROOT = join(WDIR, '../../..');
const require = createRequire(import.meta.url);

async function installedPackage(name: string, resolver = require): Promise<{ readonly version: string; readonly path: string }> {
  let directory = dirname(resolver.resolve(name.startsWith('@types/') ? `${name}/package.json` : name));
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
  const manifest: { dependencies: Record<string, string>; devDependencies: Record<string, string> } = JSON.parse(await readFile(join(WDIR, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(await Promise.all(
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).map(async (name) => [name, await installedPackage(name)] as const),
  ));
  const adapterFastify = Object.fromEntries(await Promise.all(
    ['@nestjs/platform-fastify', '@fluojs/platform-fastify'].map(async (name) => [name, await installedPackage('fastify', createRequire(require.resolve(name)))] as const),
  ));
  let bun: string | null;
  try { bun = (await execute('bun', ['--version'])).stdout.trim(); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    bun = null;
  }
  const gitSha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: WORKSPACE_ROOT })).stdout.trim();
  const gitStatus = (await execute('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: WORKSPACE_ROOT })).stdout;
  const lockfiles = Object.fromEntries(await Promise.all(
    [join(WORKSPACE_ROOT, 'pnpm-lock.yaml'), join(WDIR, 'pnpm-lock.yaml')].map(async (path) => [path, createHash('sha256').update(await readFile(path)).digest('hex')] as const),
  ));
  return {
    capturedAt: new Date().toISOString(), arch: arch(), platform: platform(),
    cpuModel: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length,
    node: process.version, nodeExecutable: process.execPath, bun,
    pnpm: (await execute('pnpm', ['--version'])).stdout.trim(),
    dependencies, adapterFastify, lockfiles,
    git: { sha: gitSha, dirty: gitStatus.length > 0, status: gitStatus },
  };
}

export type EnvironmentSummary = Awaited<ReturnType<typeof environmentSummary>>;
