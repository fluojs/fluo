import { spawn } from 'node:child_process';

import type { PackageManager } from './types.js';

export async function installDependencies(targetDirectory: string, packageManager: PackageManager): Promise<void> {
  const command = packageManager;
  const args = packageManager === 'yarn' ? [] : ['install'];

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
