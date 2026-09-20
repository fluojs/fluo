import { type ChildProcess, spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppShape } from './scenarios';

const FLUO_FASTIFY_PORT = 3001;
const NESTJS_PORT = 3002;
const FLUO_BUN_PORT = 3003;
export const WDIR = fileURLToPath(new URL('../', import.meta.url));
const FLUO_FASTIFY_BUILD_DIR = join(WDIR, 'dist/fluo-fastify');
const FLUO_BUN_BUILD_DIR = join(WDIR, 'dist/fluo-bun');
const NESTJS_BUILD_DIR = join(WDIR, 'dist/nestjs');

type TargetName = 'nestjs-fastify' | 'fluo-fastify' | 'fluo-bun';
export interface TargetConfig {
  name: TargetName;
  label: string;
  port: number;
  command: string;
  args: string[];
}

export const TARGETS: TargetConfig[] = [
  {
    name: 'nestjs-fastify',
    label: 'Nest+Fastify',
    port: NESTJS_PORT,
    command: 'node',
    args: ['dist/nestjs/nestjs/server.js'],
  },
  {
    name: 'fluo-fastify',
    label: 'fluo+Fastify',
    port: FLUO_FASTIFY_PORT,
    command: 'node',
    args: ['dist/fluo-fastify/fluo/server.js'],
  },
  {
    name: 'fluo-bun',
    label: 'fluo+Bun',
    port: FLUO_BUN_PORT,
    command: 'bun',
    args: ['run', 'dist/fluo-bun/fluo-bun/server.js'],
  },
];

export function waitForTarget(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Target readiness timed out')), 20_000);
    const onExit = (code: number | null) => finish(new Error(`Target exited before readiness: ${code}`));
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      if (output.includes('listening on :')) finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', onData);
      child.removeListener('error', finish);
      child.removeListener('exit', onExit);
      if (error) reject(error); else resolve();
    };
    child.stdout?.on('data', onData);
    child.once('error', finish);
    child.once('exit', onExit);
  });
}

export const buildCommands: { command: string; args: string[]; cwd: string; startedAt: string; completedAt: string }[] = [];

export function runCommand(command: string, args: string[]): Promise<void> {
  const startedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: WDIR,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    child.on('error', reject);
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        buildCommands.push({ command, args: [...args], cwd: WDIR, startedAt, completedAt: new Date().toISOString() });
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

export function startTargets(appShape: AppShape, targets: readonly TargetConfig[]): ChildProcess[] {
  return targets.map((target) => {
    const child = spawn(target.command, target.args, {
      cwd: WDIR,
      detached: true,
      env: { ...process.env, BENCH_APP_SHAPE: appShape, PORT: String(target.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${target.name}] ${String(d)}`));
    return child;
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout | undefined;
    const settle = (): void => {
      if (timeout) {
        clearTimeout(timeout);
      }

      child.removeListener('exit', settle);
      resolve();
    };

    timeout = setTimeout(settle, timeoutMs);
    child.once('exit', settle);
  });
}

function signalTarget(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export async function stopTargets(processes: readonly ChildProcess[]): Promise<void> {
  for (const child of processes) {
    signalTarget(child, 'SIGTERM');
  }

  await Promise.all(processes.map((child) => waitForChildExit(child, 1_500)));

  for (const child of processes) {
    signalTarget(child, 'SIGKILL');
  }

  await Promise.all(processes.map((child) => waitForChildExit(child, 1_000)));
}

async function buildBunTarget(): Promise<void> {
  await rm(FLUO_BUN_BUILD_DIR, { force: true, recursive: true });
  await runCommand('pnpm', [
    'exec',
    'tsc',
    'src/fluo-bun/server.ts',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--strict',
    '--skipLibCheck',
    '--outDir',
    'dist/fluo-bun',
  ]);
}

async function buildFluoFastifyTarget(): Promise<void> {
  await rm(FLUO_FASTIFY_BUILD_DIR, { force: true, recursive: true });
  await runCommand('pnpm', [
    'exec',
    'tsc',
    'src/fluo/server.ts',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--strict',
    '--skipLibCheck',
    '--outDir',
    'dist/fluo-fastify',
  ]);
}

async function buildNestTarget(): Promise<void> {
  await rm(NESTJS_BUILD_DIR, { force: true, recursive: true });
  await runCommand('pnpm', ['exec', 'tsc', '-p', 'nestjs/tsconfig.json', '--outDir', 'dist/nestjs']);
  await writeFile(join(NESTJS_BUILD_DIR, 'package.json'), '{"type":"commonjs"}\n');
}

export async function buildTarget(target: TargetConfig): Promise<void> {
  switch (target.name) {
    case 'nestjs-fastify':
      await buildNestTarget();
      return;
    case 'fluo-fastify':
      await buildFluoFastifyTarget();
      return;
    case 'fluo-bun':
      await buildBunTarget();
      return;
  }
}

