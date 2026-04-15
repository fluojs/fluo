#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKSPACE_BUILD_LOCK_DIRECTORY = '.workspace-build-closure.lock';
const WORKSPACE_BUILD_LOCK_TIMEOUT_MS = 120_000;
const WORKSPACE_BUILD_LOCK_POLL_MS = 50;

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireWorkspaceBuildLock(rootDirectory) {
  const lockDirectory = join(rootDirectory, WORKSPACE_BUILD_LOCK_DIRECTORY);
  const deadline = Date.now() + WORKSPACE_BUILD_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      mkdirSync(lockDirectory);

      return () => {
        rmSync(lockDirectory, { force: true, recursive: true });
      };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for workspace build lock at ${lockDirectory}.`);
      }

      sleep(WORKSPACE_BUILD_LOCK_POLL_MS);
    }
  }
}

function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const execPath = process.env.npm_execpath ?? '';

  if (userAgent.startsWith('pnpm/') || execPath.includes('pnpm')) {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  }

  if (userAgent.startsWith('yarn/') || execPath.includes('yarn')) {
    return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  }

  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function readWorkspaceGlobs(rootDirectory) {
  const pnpmWorkspacePath = join(rootDirectory, 'pnpm-workspace.yaml');

  if (existsSync(pnpmWorkspacePath)) {
    const content = readFileSync(pnpmWorkspacePath, 'utf8');
    const matches = [...content.matchAll(/^\s+-\s+['"]?([^'"#\n]+?)['"]?\s*$/gm)];

    if (matches.length > 0) {
      return matches.map((match) => match[1].trim());
    }
  }

  const packageJsonPath = join(rootDirectory, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Workspace root package.json was not found at ${packageJsonPath}.`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!Array.isArray(packageJson.workspaces)) {
    throw new Error('Could not find workspace definitions in pnpm-workspace.yaml or package.json workspaces.');
  }

  return packageJson.workspaces;
}

function collectWorkspaceManifests(rootDirectory) {
  const manifests = [];

  for (const workspace of readWorkspaceGlobs(rootDirectory)) {
    const [segment] = workspace.split('/');
    const workspaceDirectory = join(rootDirectory, segment);

    if (!existsSync(workspaceDirectory)) {
      continue;
    }

    for (const entry of readdirSync(workspaceDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = join(workspaceDirectory, entry.name);
      const manifestPath = join(candidate, 'package.json');
      if (!existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
        continue;
      }

      manifests.push({
        directory: candidate,
        manifest,
        name: manifest.name,
      });
    }
  }

  return manifests;
}

function collectLocalDependencies(manifest, workspaceNames) {
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];

  const dependencies = new Set();
  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      continue;
    }

    for (const [dependencyName, dependencyVersion] of Object.entries(section)) {
      if (!workspaceNames.has(dependencyName)) {
        continue;
      }

      if (typeof dependencyVersion === 'string' && (dependencyVersion.startsWith('workspace:') || dependencyVersion === 'catalog:')) {
        dependencies.add(dependencyName);
      }
    }
  }

  return [...dependencies].sort((left, right) => left.localeCompare(right));
}

export function resolveWorkspaceBuildOrder(targetPackageName, rootDirectory) {
  const workspaceManifests = collectWorkspaceManifests(rootDirectory);
  const manifestByName = new Map(workspaceManifests.map((entry) => [entry.name, entry]));
  const workspaceNames = new Set(workspaceManifests.map((entry) => entry.name));

  if (!manifestByName.has(targetPackageName)) {
    throw new Error(`Could not find workspace package ${targetPackageName}.`);
  }

  const visiting = new Set();
  const visited = new Set();
  const order = [];

  function visit(packageName) {
    if (visited.has(packageName)) {
      return;
    }

    if (visiting.has(packageName)) {
      throw new Error(`Detected a workspace dependency cycle involving ${packageName}.`);
    }

    const entry = manifestByName.get(packageName);
    if (!entry) {
      throw new Error(`Workspace package ${packageName} is missing from manifest map.`);
    }

    visiting.add(packageName);
    for (const dependencyName of collectLocalDependencies(entry.manifest, workspaceNames)) {
      visit(dependencyName);
    }
    visiting.delete(packageName);
    visited.add(packageName);
    order.push(packageName);
  }

  visit(targetPackageName);
  return order;
}

export function runWorkspaceBuildClosure(targetPackageName, rootDirectory, options = {}) {
  const packageManager = options.packageManager ?? detectPackageManager();
  const stdio = options.stdio ?? 'pipe';
  const order = resolveWorkspaceBuildOrder(targetPackageName, rootDirectory);
  const workspaceManifests = collectWorkspaceManifests(rootDirectory);
  const manifestByName = new Map(workspaceManifests.map((entry) => [entry.name, entry]));
  const releaseLock = acquireWorkspaceBuildLock(rootDirectory);

  let stdout = '';
  let stderr = '';

  try {
    for (const packageName of order) {
      const entry = manifestByName.get(packageName);
      if (!entry || typeof entry.manifest.scripts?.build !== 'string') {
        continue;
      }

      const args = packageManager.startsWith('npm') ? ['run', 'build'] : ['run', 'build'];
      const result = spawnSync(packageManager, args, {
        cwd: entry.directory,
        encoding: 'utf8',
        stdio,
      });

      if (stdio === 'pipe') {
        stdout += `\n[build:${packageName}]\n${result.stdout ?? ''}`;
        stderr += `\n[build:${packageName}]\n${result.stderr ?? ''}`;
      }

      if (result.error) {
        throw result.error;
      }

      if (result.signal) {
        stderr = `${stderr}\nBuild for ${packageName} terminated by signal ${result.signal}.`.trim();
        return {
          order,
          packageManager,
          status: 1,
          stderr,
          stdout: stdout.trim(),
        };
      }

      if (typeof result.status !== 'number') {
        stderr = `${stderr}\nBuild for ${packageName} exited without a numeric status.`.trim();
        return {
          order,
          packageManager,
          status: 1,
          stderr,
          stdout: stdout.trim(),
        };
      }

      if (result.status !== 0) {
        return {
          order,
          packageManager,
          status: result.status,
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        };
      }
    }

    return {
      order,
      packageManager,
      status: 0,
      stderr: stderr.trim(),
      stdout: stdout.trim(),
    };
  } finally {
    releaseLock();
  }
}

function main() {
  const [targetPackageName] = process.argv.slice(2);
  if (!targetPackageName) {
    throw new Error('Usage: node ./tooling/scripts/run-workspace-build-closure.mjs <workspace-package-name>');
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const rootDirectory = resolve(scriptDirectory, '..', '..');
  const result = runWorkspaceBuildClosure(targetPackageName, rootDirectory, { stdio: 'inherit' });

  if (result.status !== 0) {
    process.exit(result.status);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
