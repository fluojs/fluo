import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type RestartRunnerStream = {
  isTTY?: boolean;
  write(message: string): unknown;
};

type RestartChildSpawner = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => ChildProcess;
/** Runtime target handled by the fluo-owned development restart runner. */
export type DevRunnerRuntime = 'bun' | 'cloudflare-workers' | 'deno' | 'node';

type RestartSignal = 'SIGINT' | 'SIGTERM';

type RestartSignalTarget = {
  off(signal: RestartSignal, listener: () => void): unknown;
  once(signal: RestartSignal, listener: () => void): unknown;
};

type RestartWatcherFactory = (target: string, optionsOrListener: { recursive: boolean } | ((event: string, filename: string | Buffer | null) => void), listener?: (event: string, filename: string | Buffer | null) => void) => FSWatcher;

type ContentChangeGate = {
  commitBaseline(paths: Iterable<string>): void;
  hasMeaningfulChange(paths: Iterable<string>): boolean;
};

/** Options used to configure the fluo-owned Node restart-on-watch process boundary. */
export type NodeRestartRunnerOptions = {
  appArgs?: string[];
  debounceMs?: number;
  env: NodeJS.ProcessEnv;
  projectDirectory?: string;
  runtime?: DevRunnerRuntime;
  signalTarget?: RestartSignalTarget;
  spawnChild?: RestartChildSpawner;
  stderr?: RestartRunnerStream;
  stdout?: RestartRunnerStream;
  watchTarget?: RestartWatcherFactory;
};

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;
const PRETTY_TTY_COLOR_ENV = 'FLUO_DEV_PRETTY_TTY_COLOR';
const DEFAULT_IGNORES = [
  '.cache',
  '.fluo',
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  '*.swp',
  '*.swo',
  '*~',
  '.#*',
];
const WATCH_FILES = ['.env', 'package.json', 'tsconfig.json', 'tsconfig.build.json'];
const SHOW_NODE_RESTART_NOTICE_ENV = 'FLUO_DEV_SHOW_RESTART_NOTICE';
const CLEAR_SCREEN = '\u001B[2J\u001B[3J\u001B[H';

function normalizeIgnorePatterns(patterns: string[]): string[] {
  return patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
}

function parseIgnorePatterns(env: NodeJS.ProcessEnv): string[] {
  const configured = env.FLUO_DEV_WATCH_IGNORE?.split(',') ?? [];
  return normalizeIgnorePatterns([...DEFAULT_IGNORES, ...configured]);
}

function matchesSegmentPattern(segment: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    return segment.endsWith(pattern.slice(1));
  }

  if (pattern.endsWith('*')) {
    return segment.startsWith(pattern.slice(0, -1));
  }

  return segment === pattern;
}

function shouldIgnorePath(filePath: string, projectDirectory: string, ignorePatterns: string[]): boolean {
  const relativePath = relative(projectDirectory, filePath);
  if (relativePath.startsWith('..')) {
    return true;
  }

  const segments = relativePath.split(sep).filter(Boolean);
  return segments.some((segment) => ignorePatterns.some((pattern) => matchesSegmentPattern(segment, pattern)));
}

function hashFileContent(filePath: string): string | undefined {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return undefined;
    }

    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch (_error: unknown) {
    return undefined;
  }
}

function collectContentPaths(filePath: string, projectDirectory: string, ignorePatterns: string[], paths: Set<string>): void {
  if (shouldIgnorePath(filePath, projectDirectory, ignorePatterns)) {
    return;
  }

  try {
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(filePath)) {
        collectContentPaths(join(filePath, entry), projectDirectory, ignorePatterns, paths);
      }
      return;
    }

    if (stats.isFile()) {
      paths.add(filePath);
    }
  } catch (_error: unknown) {
    paths.add(filePath);
  }
}

function collectWatchedContentPaths(paths: Iterable<string>, projectDirectory: string, ignorePatterns: string[]): Set<string> {
  const collected = new Set<string>();
  for (const filePath of paths) {
    collectContentPaths(filePath, projectDirectory, ignorePatterns, collected);
  }

  return collected;
}

/**
 * Creates a content-diff gate for fluo-owned dev restarts.
 *
 * @param projectDirectory Project root used for ignore matching.
 * @param ignorePatterns Additional or default ignore patterns to apply before hashing.
 * @returns A gate that reports whether watched paths changed by content rather than by filesystem event alone.
 */
export function createContentChangeGate(projectDirectory: string, ignorePatterns: string[] = DEFAULT_IGNORES): ContentChangeGate {
  const normalizedIgnores = normalizeIgnorePatterns(ignorePatterns);
  const hashes = new Map<string, string | undefined>();

  return {
    commitBaseline(paths) {
      for (const filePath of collectWatchedContentPaths(paths, projectDirectory, normalizedIgnores)) {
        hashes.set(filePath, hashFileContent(filePath));
      }
    },
    hasMeaningfulChange(paths) {
      for (const filePath of collectWatchedContentPaths(paths, projectDirectory, normalizedIgnores)) {
        const nextHash = hashFileContent(filePath);
        const previousHash = hashes.get(filePath);

        if (previousHash !== nextHash) {
          return true;
        }
      }

      return false;
    },
  };
}

function getWatchTargets(projectDirectory: string): string[] {
  return [join(projectDirectory, 'src'), ...WATCH_FILES.map((fileName) => join(projectDirectory, fileName))].filter((target) => existsSync(target));
}

function stopChild(child: ChildProcess | undefined, shutdownTimeoutMs = DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS): void {
  if (child && child.exitCode === null && !child.killed) {
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, shutdownTimeoutMs);

    forceKillTimer.unref?.();
    child.once('close', () => {
      clearTimeout(forceKillTimer);
    });
    child.kill('SIGTERM');
  }
}

function getPreserveColorTtyImport(): string {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), 'dev-runner', 'preserve-color-tty.js');
}

function buildNodeAppArgs(env: NodeJS.ProcessEnv, appArgs: string[]): string[] {
  const colorTtyImport = env[PRETTY_TTY_COLOR_ENV] === '1' ? ['--import', getPreserveColorTtyImport()] : [];

  return ['--env-file=.env', ...colorTtyImport, '--import', 'tsx', 'src/main.ts', ...appArgs];
}

function buildBunAppArgs(env: NodeJS.ProcessEnv, appArgs: string[]): string[] {
  const colorTtyPreload = env[PRETTY_TTY_COLOR_ENV] === '1' ? ['--preload', getPreserveColorTtyImport()] : [];

  return [...colorTtyPreload, 'src/main.ts', ...appArgs];
}

function buildAppCommand(runtime: DevRunnerRuntime, env: NodeJS.ProcessEnv, appArgs: string[]): { args: string[]; command: string } {
  switch (runtime) {
    case 'bun':
      return { command: 'bun', args: buildBunAppArgs(env, appArgs) };
    case 'cloudflare-workers':
      return { command: 'wrangler', args: ['dev', '--show-interactive-dev-session=false', ...appArgs] };
    case 'deno':
      return { command: 'deno', args: ['run', '--allow-env', '--allow-net', 'src/main.ts', ...appArgs] };
    default:
      return { command: process.execPath, args: buildNodeAppArgs(env, appArgs) };
  }
}

function readDevScriptHeader(projectDirectory: string): string {
  const fallbackName = basename(projectDirectory);

  try {
    const manifest = JSON.parse(readFileSync(join(projectDirectory, 'package.json'), 'utf8')) as {
      name?: unknown;
      scripts?: { dev?: unknown };
      version?: unknown;
    };
    const name = typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : fallbackName;
    const version = typeof manifest.version === 'string' && manifest.version.length > 0 ? `@${manifest.version}` : '';
    const devScript = typeof manifest.scripts?.dev === 'string' && manifest.scripts.dev.length > 0 ? manifest.scripts.dev : 'fluo dev';

    return `> ${name}${version} dev ${projectDirectory}\n> ${devScript}\n\n`;
  } catch (_error: unknown) {
    return `> ${fallbackName} dev ${projectDirectory}\n> fluo dev\n\n`;
  }
}

function redrawDevScriptHeader(stdout: RestartRunnerStream, projectDirectory: string, env: NodeJS.ProcessEnv): void {
  if (env[SHOW_NODE_RESTART_NOTICE_ENV] !== '1') {
    return;
  }

  stdout.write(CLEAR_SCREEN);
  stdout.write(readDevScriptHeader(projectDirectory));
}

/**
 * Runs the Node.js development lifecycle through fluo-owned restart supervision.
 *
 * @param options Runner dependencies and project settings.
 * @returns A promise that resolves with the final child exit code when the runner stops.
 */
export async function runNodeRestartRunner(options: NodeRestartRunnerOptions): Promise<number> {
  const projectDirectory = options.projectDirectory ?? process.cwd();
  const env = options.env;
  const runnerRuntime = options.runtime ?? 'node';
  const signalTarget = options.signalTarget ?? process;
  const spawnChild = options.spawnChild ?? spawn;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const watchTarget = options.watchTarget ?? watch;
  const appArgs = options.appArgs ?? [];
  const debounceMs = options.debounceMs ?? Number(env.FLUO_DEV_RELOAD_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
  const childShutdownTimeoutMs = Number(env.FLUO_DEV_CHILD_SHUTDOWN_TIMEOUT_MS ?? DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS);
  const gate = createContentChangeGate(projectDirectory, parseIgnorePatterns(env));
  const watchTargets = getWatchTargets(projectDirectory);
  let child: ChildProcess | undefined;
  const pendingRestartPaths = new Set<string>();
  const restartAfterClosePaths = new Set<string>();
  let restartTimer: NodeJS.Timeout | undefined;
  let restarting = false;
  let stopping = false;

  const startChild = (resolveExitCode: (code: number) => void, cleanup: () => void) => {
    const appCommand = buildAppCommand(runnerRuntime, env, appArgs);
    child = spawnChild(appCommand.command, appCommand.args, {
      cwd: projectDirectory,
      env,
      stdio: 'inherit',
    });
    child.once('close', (code) => {
      if (restarting) {
        return;
      }
      if (stopping) {
        cleanup();
        resolveExitCode(code ?? 0);
        return;
      }
      cleanup();
      resolveExitCode(code ?? 1);
    });
  };

  const scheduleRestart = (filePath: string, resolveExitCode: (code: number) => void, cleanup: () => void) => {
    pendingRestartPaths.add(filePath);

    if (restartTimer) {
      clearTimeout(restartTimer);
    }

    restartTimer = setTimeout(() => {
      const restartPaths = [...pendingRestartPaths];
      pendingRestartPaths.clear();
      restartTimer = undefined;

      if (!gate.hasMeaningfulChange(restartPaths)) {
        return;
      }

      if (env[SHOW_NODE_RESTART_NOTICE_ENV] === '1') {
        stdout.write(`[fluo] restarting after content change: ${relative(projectDirectory, restartPaths[restartPaths.length - 1] ?? projectDirectory)}\n`);
      }
      const previousChild = child;
      const startReplacementChild = () => {
        redrawDevScriptHeader(stdout, projectDirectory, env);
        startChild(resolveExitCode, cleanup);
        gate.commitBaseline(restartPaths);
      };

      if (previousChild) {
        for (const restartPath of restartPaths) {
          restartAfterClosePaths.add(restartPath);
        }
        if (restarting) {
          return;
        }

        restarting = true;
        previousChild.once('close', () => {
          const committedRestartPaths = [...restartAfterClosePaths];
          restartAfterClosePaths.clear();
          restarting = false;
          if (stopping) {
            return;
          }
          redrawDevScriptHeader(stdout, projectDirectory, env);
          startChild(resolveExitCode, cleanup);
          gate.commitBaseline(committedRestartPaths);
        });
        stopChild(previousChild, childShutdownTimeoutMs);
        return;
      }

      try {
        startReplacementChild();
      } finally {
        restarting = false;
      }
    }, debounceMs);
  };

  gate.commitBaseline(watchTargets);

  return new Promise((resolveExitCode) => {
    const watchers: FSWatcher[] = [];
    let cleanedUp = false;

    const stop = () => {
      stopping = true;
      cleanup();
      stopChild(child, childShutdownTimeoutMs);
    };

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
      }
      pendingRestartPaths.clear();
      restartAfterClosePaths.clear();
      for (const watcher of watchers.splice(0)) {
        watcher.close();
      }
      signalTarget.off('SIGINT', stop);
      signalTarget.off('SIGTERM', stop);
    };

    startChild(resolveExitCode, cleanup);

    for (const target of watchTargets) {
      try {
        const stats = statSync(target);
        const watchOptions = { recursive: stats.isDirectory() };
        const listener = (_event: string, filename: string | Buffer | null) => {
          const fileName = filename ? String(filename) : basename(target);
          scheduleRestart(stats.isDirectory() ? join(target, fileName) : target, resolveExitCode, cleanup);
        };
        try {
          watchers.push(watchTarget(target, watchOptions, listener));
        } catch (error: unknown) {
          if (!stats.isDirectory()) {
            throw error;
          }
          watchers.push(watchTarget(target, listener));
        }
      } catch (error: unknown) {
        stderr.write(`[fluo] unable to watch ${target}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }

    signalTarget.once('SIGINT', stop);
    signalTarget.once('SIGTERM', stop);
  });
}
