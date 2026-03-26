import { spawn } from 'node:child_process';

import type { PackageManager } from './types.js';

export interface InstallCommand {
  args: string[];
  command: string;
}

export function resolveInstallCommand(packageManager: PackageManager): InstallCommand {
  if (packageManager === 'yarn') {
    return {
      args: ['yarn', 'install', '--no-cache'],
      command: 'corepack',
    };
  }

  return {
    args: ['install'],
    command: packageManager,
  };
}

export async function installDependencies(targetDirectory: string, packageManager: PackageManager): Promise<void> {
  const { args, command } = resolveInstallCommand(packageManager);

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
