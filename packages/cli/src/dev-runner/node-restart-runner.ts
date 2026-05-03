import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

type RestartRunnerStream = {
  write(message: string): unknown;
};

type RestartChildSpawner = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => ChildProcess;

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

export type NodeRestartRunnerOptions = {
  appArgs?: string[];
  debounceMs?: number;
  env: NodeJS.ProcessEnv;
  projectDirectory?: string;
  signalTarget?: RestartSignalTarget;
  spawnChild?: RestartChildSpawner;
  stderr?: RestartRunnerStream;
  stdout?: RestartRunnerStream;
  watchTarget?: RestartWatcherFactory;
};

const DEFAULT_DEBOUNCE_MS = 100;
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

function stopChild(child: ChildProcess | undefined): void {
  if (child && child.exitCode === null && !child.killed) {
    child.kill('SIGTERM');
  }
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
  const signalTarget = options.signalTarget ?? process;
  const spawnChild = options.spawnChild ?? spawn;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const watchTarget = options.watchTarget ?? watch;
  const appArgs = options.appArgs ?? [];
  const debounceMs = options.debounceMs ?? Number(env.FLUO_DEV_RELOAD_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
  const gate = createContentChangeGate(projectDirectory, parseIgnorePatterns(env));
  const watchTargets = getWatchTargets(projectDirectory);
  let child: ChildProcess | undefined;
  const pendingRestartPaths = new Set<string>();
  let restartTimer: NodeJS.Timeout | undefined;
  let restarting = false;
  let stopping = false;

  const startChild = (resolveExitCode: (code: number) => void, cleanup: () => void) => {
    child = spawnChild(process.execPath, ['--env-file=.env', '--import', 'tsx', 'src/main.ts', ...appArgs], {
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

      gate.commitBaseline(restartPaths);
      stdout.write(`[fluo] restarting after content change: ${relative(projectDirectory, restartPaths[restartPaths.length - 1] ?? projectDirectory)}\n`);
      const previousChild = child;
      restarting = true;
      previousChild?.once('close', () => {
        restarting = false;
        startChild(resolveExitCode, cleanup);
      });
      stopChild(previousChild);
      if (!previousChild) {
        restarting = false;
        startChild(resolveExitCode, cleanup);
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
      stopChild(child);
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
