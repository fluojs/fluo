import { type ChildProcess, spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppShape } from './scenarios';

export const WDIR = fileURLToPath(new URL('../', import.meta.url));
const FLUO_FASTIFY_BUILD_DIR = join(WDIR, 'dist/fluo-fastify');
const FLUO_BUN_BUILD_DIR = join(WDIR, 'dist/fluo-bun');
const NESTJS_BUILD_DIR = join(WDIR, 'dist/nestjs');
const activeTargets = new Set<ChildProcess>();

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    void stopTargets([...activeTargets]).then(
      () => process.exit(exitCode),
      (error: Error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(exitCode);
      },
    );
  });
}
process.once('exit', () => {
  for (const child of activeTargets) signalTarget(child, 'SIGKILL');
});

export type Platform = 'fastify' | 'express' | 'nodejs' | 'bun' | 'deno' | 'workers' | 'nextjs';
export type Product = 'native' | 'fluo' | 'nestjs';
type TargetName = `${Product}-${Platform}`;
export interface TargetConfig {
  name: TargetName;
  platform: Platform;
  product: Product;
  label: string;
  port: number;
  command: string;
  args: string[];
}

export const PLATFORMS: readonly Platform[] = ['fastify', 'express', 'nodejs', 'bun', 'deno', 'workers', 'nextjs'];
export const TARGETS: TargetConfig[] = PLATFORMS.flatMap((platform) => {
  const products: readonly Product[] = platform === 'fastify' || platform === 'express' ? ['native', 'fluo', 'nestjs'] : ['native', 'fluo'];
  return products.map((product) => {
    const name: TargetName = `${product}-${platform}`;
    const port = Number(process.env.BENCH_PORT_BASE ?? 33909) + PLATFORMS.indexOf(platform) * 3 + products.indexOf(product);
    const source = product === 'nestjs' ? 'nestjs' : name === 'fluo-fastify' ? 'fluo' : name;
    const args = platform === 'bun' ? ['run', `dist/${name}/${source}/server.js`]
      : platform === 'deno' ? ['run', `--allow-net=${process.env.BENCH_BIND_HOST ?? '127.0.0.1'}`, '--allow-read', '--allow-env', `dist/${name}/server.mjs`, String(port)]
      : platform === 'workers' ? ['node_modules/wrangler/bin/wrangler.js', 'dev', `src/${source}/server.ts`, '--local', '--ip', process.env.BENCH_BIND_HOST ?? '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--compatibility-date', '2025-06-01', '--compatibility-flags', 'nodejs_compat']
      : platform === 'nextjs' ? ['node_modules/next/dist/bin/next', 'start', `nextjs/${product}`, '--hostname', process.env.BENCH_BIND_HOST ?? '127.0.0.1', '--port', String(port)]
      : [`dist/${product === 'nestjs' ? 'nestjs' : name}/${source}/server.js`];
    return { name, platform, product, label: name, port, command: platform === 'bun' ? 'bun' : platform === 'deno' ? 'deno' : 'node', args };
  });
});

export function waitForTarget(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error(`Target readiness timed out: ${output}`)), 60_000);
    const onExit = (code: number | null) => finish(new Error(`Target exited before readiness: ${code}\n${output}`));
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      if (/listening on :|Ready in|Ready on http/.test(output)) finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', onData);
      child.stderr?.removeListener('data', onData);
      child.removeListener('error', finish);
      child.removeListener('close', onExit);
      if (error) reject(error); else resolve();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', finish);
    child.once('close', onExit);
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

export interface TargetLaunchOptions {
  readonly inspectorPort?: number;
  readonly gcTrace?: boolean;
  readonly env?: Readonly<Record<string, string>>;
  readonly quiet?: boolean;
  readonly onOutput?: (target: TargetConfig, stream: 'stdout' | 'stderr', data: Buffer) => void;
}

export function targetLaunch(target: TargetConfig, appShape: AppShape, options: TargetLaunchOptions = {}) {
  const configuration = options.env?.BENCH_CONFIGURATION ?? process.env.BENCH_CONFIGURATION ?? 'default';
  const args = target.platform === 'workers' ? [...target.args, '--var', `BENCH_APP_SHAPE:${appShape}`, '--var', `BENCH_CONFIGURATION:${configuration}`]
    : target.platform === 'deno' ? [...target.args, appShape] : [...target.args];
  if (options.inspectorPort !== undefined) {
    const address = `127.0.0.1:${options.inspectorPort}`;
    switch (target.platform) {
      case 'workers':
        args[args.indexOf('--inspector-port') + 1] = String(options.inspectorPort);
        break;
      case 'bun': args.unshift(`--inspect=${address}/3910`); break;
      case 'deno': args.splice(1, 0, `--inspect=${address}`); break;
      case 'fastify': case 'express': case 'nodejs': case 'nextjs':
        args.unshift(`--inspect=${address}`);
        break;
    }
  }
  if (options.gcTrace) {
    if (target.platform === 'deno') args.splice(1, 0, '--v8-flags=--trace-gc');
    else if (target.command === 'node' && target.platform !== 'workers') args.unshift('--trace-gc');
  }
  return {
    command: target.command, args, cwd: WDIR,
    env: { ...process.env, ...options.env, BENCH_APP_SHAPE: appShape, BENCH_TARGET: target.name, PORT: String(target.port), WRANGLER_SEND_METRICS: 'false', NEXT_TELEMETRY_DISABLED: '1' },
  };
}

export function startTargets(appShape: AppShape, targets: readonly TargetConfig[], options: TargetLaunchOptions = {}): ChildProcess[] {
  return targets.map((target) => {
    const launch = targetLaunch(target, appShape, options);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      detached: true,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => options.onOutput?.(target, 'stdout', data));
    child.stderr?.on('data', (data: Buffer) => {
      options.onOutput?.(target, 'stderr', data);
      if (!options.quiet) process.stderr.write(`[${target.name}] ${String(data)}`);
    });
    activeTargets.add(child);
    return child;
  });
}

function waitForChildStop(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const streams = [child.stdout, child.stderr].filter((stream) => stream !== null);
  const stopped = (): boolean => (child.exitCode !== null || child.signalCode !== null)
    && streams.every((stream) => stream.readableEnded && stream.closed);
  if (stopped()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (complete: boolean): void => {
      clearTimeout(timeout);
      child.removeListener('exit', check);
      child.removeListener('close', check);
      child.removeListener('error', failed);
      for (const stream of streams) {
        stream.removeListener('end', check);
        stream.removeListener('close', check);
        stream.removeListener('error', failed);
      }
      resolve(complete);
    };
    const check = (): void => { if (stopped()) settle(true); };
    const failed = (): void => settle(false);
    const timeout = setTimeout(() => settle(false), timeoutMs);
    child.on('exit', check);
    child.on('close', check);
    child.on('error', failed);
    for (const stream of streams) {
      stream.on('end', check);
      stream.on('close', check);
      stream.on('error', failed);
    }
    check();
  });
}

function signalTarget(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

export async function stopTargets(processes: readonly ChildProcess[]): Promise<void> {
  const graceful = processes.map((child) => waitForChildStop(child, 1_500));
  for (const child of processes) {
    signalTarget(child, 'SIGTERM');
  }
  const completed = await Promise.all(graceful);
  const remaining = processes.filter((_child, index) => !completed[index]);
  const forced = remaining.map((child) => waitForChildStop(child, 1_000));
  for (const child of remaining) {
    signalTarget(child, 'SIGKILL');
  }
  const forcedCompleted = await Promise.all(forced);
  const failed = remaining.filter((_child, index) => !forcedCompleted[index]);
  for (const child of processes) {
    if (child.exitCode !== null || child.signalCode !== null) activeTargets.delete(child);
  }
  for (const child of failed) {
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  if (failed.length > 0) {
    throw new Error(`Target teardown timed out or output closed without draining: ${failed.map((child) => child.pid).join(', ')}`);
  }
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
  if (target.platform === 'nextjs') {
    if (target.product === 'native') {
      await runCommand('pnpm', ['exec', 'tsc', 'src/shared/native-app.ts', 'src/shared/app-shape.ts', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck', '--declaration', '--outDir', 'dist/next-native']);
    }
    if (target.product === 'fluo') {
      await runCommand('pnpm', ['exec', 'tsc', 'src/shared/fluo-app.ts', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck', '--declaration', '--outDir', 'dist/next-backend']);
    }
    await runCommand('node', ['node_modules/next/dist/bin/next', 'build', `nextjs/${target.product}`, '--turbopack']);
    return;
  }
  if (target.platform === 'workers') return; // Wrangler compiles the entrypoint for real workerd.
  if (target.product === 'nestjs') { await buildNestTarget(); return; }
  if (target.name === 'fluo-fastify') { await buildFluoFastifyTarget(); return; }
  if (target.name === 'fluo-bun') { await buildBunTarget(); return; }
  await runCommand('pnpm', ['exec', 'tsc', `src/${target.name}/server.ts`, '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck', '--esModuleInterop', '--outDir', `dist/${target.name}`]);
  if (target.platform === 'deno') {
    await runCommand('pnpm', ['exec', 'esbuild', `dist/${target.name}/${target.name}/server.js`, '--bundle', '--platform=node', '--format=esm', `--outfile=dist/${target.name}/server.mjs`]);
  }
}

