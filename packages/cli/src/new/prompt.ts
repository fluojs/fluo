import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { BootstrapAnswers, PackageManager } from './types.js';

export const DEFAULT_PACKAGE_MANAGER: PackageManager = 'pnpm';

function assertValidProjectName(projectName: string): string {
  const trimmed = projectName.trim();

  if (trimmed.length === 0) {
    throw new Error('Project name is required.');
  }

  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error(`Invalid project name "${projectName}": must not contain path separators or traversal sequences.`);
  }

  return trimmed;
}

function parsePackageManager(value: string | undefined): PackageManager | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith('bun')) {
    return 'bun';
  }

  if (value.startsWith('pnpm')) {
    return 'pnpm';
  }

  if (value.startsWith('yarn')) {
    return 'yarn';
  }

  if (value.startsWith('npm')) {
    return 'npm';
  }

  return undefined;
}

function detectFromUserAgent(userAgent: string | undefined): PackageManager | undefined {
  if (!userAgent) {
    return undefined;
  }

  const candidate = userAgent.split(' ')[0];
  return parsePackageManager(candidate);
}

function detectFromDirectory(startDirectory: string): PackageManager | undefined {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const packageJsonPath = join(currentDirectory, 'package.json');

    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        packageManager?: string;
      };
      const fromPackageManagerField = parsePackageManager(packageJson.packageManager);

      if (fromPackageManagerField) {
        return fromPackageManagerField;
      }
    }

    if (existsSync(join(currentDirectory, 'bun.lock')) || existsSync(join(currentDirectory, 'bun.lockb'))) {
      return 'bun';
    }

    if (existsSync(join(currentDirectory, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }

    if (existsSync(join(currentDirectory, 'yarn.lock'))) {
      return 'yarn';
    }

    if (existsSync(join(currentDirectory, 'package-lock.json'))) {
      return 'npm';
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
}

export function detectPackageManager(
  startDirectory: string,
  userAgent?: string,
): PackageManager {
  return detectFromUserAgent(userAgent)
    ?? detectFromDirectory(startDirectory)
    ?? DEFAULT_PACKAGE_MANAGER;
}

export function resolveBootstrapAnswers(
  partial: Partial<BootstrapAnswers>,
  cwd: string,
  userAgent?: string,
): BootstrapAnswers {
  if (!partial.projectName) {
    throw new Error('Project name is required.');
  }

  const projectName = assertValidProjectName(partial.projectName);

  return {
    packageManager: partial.packageManager ?? detectPackageManager(cwd, userAgent),
    projectName,
    targetDirectory: partial.targetDirectory ?? `./${projectName}`,
  };
}
