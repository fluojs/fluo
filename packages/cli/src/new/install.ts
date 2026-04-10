import { spawn, spawnSync } from 'node:child_process';

import type { PackageManager } from './types.js';

export interface InstallCommand {
  args: string[];
  command: string;
}

export interface ResolveInstallCommandOptions {
  isCorepackAvailable?: boolean;
}

const COREPACK_DOCS_URL = 'https://nodejs.org/api/corepack.html';

function checkCommandAvailability(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });

  return result.status === 0;
}

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

export async function installDependencies(targetDirectory: string, packageManager: PackageManager): Promise<void> {
  const hasCorepack = packageManager === 'yarn' ? checkCommandAvailability('corepack') : undefined;
  const { args, command } = resolveInstallCommand(packageManager, { isCorepackAvailable: hasCorepack });

  if (packageManager === 'yarn' && hasCorepack === false) {
    console.warn(
      `[fluo] corepack was not found in PATH, falling back to "yarn install". See ${COREPACK_DOCS_URL}`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: targetDirectory,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Dependency installation failed with exit code ${code}.`));
    });
  });
}
