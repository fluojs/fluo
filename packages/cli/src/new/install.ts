import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { PackageManager } from './types.js';

/** Concrete command invocation used for dependency installation. */
export interface InstallCommand {
  args: string[];
  command: string;
}

/** Runtime overrides for resolving install commands in tests. */
export interface ResolveInstallCommandOptions {
  isCorepackAvailable?: boolean;
}

/** Runtime overrides for git initialization in tests. */
export interface InitializeGitRepositoryOptions {
  command?: string;
}

type WritableStream = {
  write(message: string): unknown;
};

type InstallStdioMode = 'capture' | 'inherit';

type InstallDependenciesOptions = {
  env?: NodeJS.ProcessEnv;
  isCorepackAvailable?: boolean;
  stderr?: WritableStream;
  stdio?: InstallStdioMode;
};

const COREPACK_DOCS_URL = 'https://nodejs.org/api/corepack.html';

class DependencyInstallationError extends Error {
  readonly output: string;

  constructor(exitCode: number | null, output: string) {
    super(
      exitCode === null
        ? 'Dependency installation failed without an exit code.'
        : `Dependency installation failed with exit code ${exitCode}.`,
    );
    this.name = 'DependencyInstallationError';
    this.output = output;
  }
}

function appendStreamOutput(
  stream: NodeJS.ReadableStream | null | undefined,
  output: string[],
): void {
  stream?.on('data', (chunk) => {
    output.push(typeof chunk === 'string' ? chunk : chunk.toString());
  });
}

function waitForChildProcess(
  child: ChildProcess,
  capturedOutput?: string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new DependencyInstallationError(code, capturedOutput?.join('') ?? ''));
    });
  });
}

function checkCommandAvailability(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });

  return result.status === 0;
}

/**
 * Resolves the concrete install command for a chosen package manager.
 *
 * @param packageManager Package manager selected for the generated starter.
 * @param options Runtime overrides for command detection in tests.
 * @returns The command and argument list to execute.
 */
export function resolveInstallCommand(
  packageManager: PackageManager,
  options: ResolveInstallCommandOptions = {},
): InstallCommand {
  if (packageManager === 'bun') {
    return {
      args: ['install'],
      command: 'bun',
    };
  }

  if (packageManager === 'yarn') {
    const isCorepackAvailable = options.isCorepackAvailable ?? checkCommandAvailability('corepack');

    if (!isCorepackAvailable) {
      return {
        args: ['install'],
        command: 'yarn',
      };
    }

    return {
      args: ['yarn', 'install'],
      command: 'corepack',
    };
  }

  return {
    args: ['install'],
    command: packageManager,
  };
}

/**
 * Installs starter dependencies in the generated project directory.
 *
 * @param targetDirectory Generated project directory.
 * @param packageManager Package manager selected for the generated starter.
 * @param options Runtime overrides for install execution and diagnostics.
 * @returns A promise that resolves when installation succeeds.
 */
export async function installDependencies(
  targetDirectory: string,
  packageManager: PackageManager,
  options: InstallDependenciesOptions = {},
): Promise<void> {
  const hasCorepack = packageManager === 'yarn'
    ? (options.isCorepackAvailable ?? checkCommandAvailability('corepack'))
    : undefined;
  const { args, command } = resolveInstallCommand(packageManager, { isCorepackAvailable: hasCorepack });

  if (packageManager === 'yarn' && hasCorepack === false) {
    const message = `[fluo] corepack was not found in PATH, falling back to "yarn install". See ${COREPACK_DOCS_URL}\n`;
    (options.stderr ?? process.stderr).write(message);
  }

  const stdio = options.stdio ?? 'inherit';

  if (stdio === 'capture') {
    const capturedOutput: string[] = [];
    const child = spawn(command, args, {
      cwd: targetDirectory,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    appendStreamOutput(child.stdout, capturedOutput);
    appendStreamOutput(child.stderr, capturedOutput);

    await waitForChildProcess(child, capturedOutput);
    return;
  }

  const child = spawn(command, args, {
    cwd: targetDirectory,
    env: options.env,
    stdio: 'inherit',
  });

  await waitForChildProcess(child);
}

/**
 * Initializes a git repository in the generated project directory.
 *
 * @param targetDirectory Generated project directory.
 * @param options Runtime overrides for invoking git in tests.
 * @returns A promise that resolves when repository initialization succeeds.
 */
export async function initializeGitRepository(
  targetDirectory: string,
  options: InitializeGitRepositoryOptions = {},
): Promise<void> {
  const command = options.command ?? 'git';

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['init'], {
      cwd: targetDirectory,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Git initialization failed with exit code ${code}.`));
    });
  });
}
