#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const execPath = process.env.npm_execpath ?? '';

  if (userAgent.startsWith('pnpm/') || execPath.includes('pnpm')) {
    return 'pnpm';
  }

  if (userAgent.startsWith('yarn/') || execPath.includes('yarn')) {
    return 'yarn';
  }

  return 'npm';
}

function readWorkspaceGlobs(rootDirectory) {
  // pnpm uses pnpm-workspace.yaml; fall back to package.json workspaces
  const pnpmWorkspacePath = join(rootDirectory, 'pnpm-workspace.yaml');

  if (existsSync(pnpmWorkspacePath)) {
    const content = readFileSync(pnpmWorkspacePath, 'utf8');
    // Match list items under the "packages:" key, e.g. `  - 'packages/*'`
    const matches = [...content.matchAll(/^\s+-\s+['"]?([^'"#\n]+?)['"]?\s*$/gm)];

    if (matches.length > 0) {
      return matches.map((m) => m[1].trim());
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

function listWorkspaceDirectories(rootDirectory, scope) {
  const workspaces = readWorkspaceGlobs(rootDirectory);
  const directories = [];

  for (const workspace of workspaces) {
    const [segment] = workspace.split('/');

    if (scope !== 'all' && scope !== segment) {
      continue;
    }

    const workspaceDirectory = join(rootDirectory, segment);

    if (!existsSync(workspaceDirectory)) {
      continue;
    }

    for (const entry of readdirSync(workspaceDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = join(workspaceDirectory, entry.name);

      if (existsSync(join(candidate, 'package.json'))) {
        directories.push(candidate);
      }
    }
  }

  return directories;
}

function hasScript(directory, scriptName) {
  const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  return typeof packageJson.scripts?.[scriptName] === 'string';
}

function runScript(directory, packageManager, scriptName) {
  const result = spawnSync(packageManager, ['run', scriptName], {
    cwd: directory,
    stdio: 'inherit',
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
}

function main() {
  const [scriptName, ...optionArgs] = process.argv.slice(2);

  if (!scriptName) {
    throw new Error('Usage: node ./tooling/scripts/run-workspace-script.mjs <script> [--scope=apps|packages|tooling|all] [--first]');
  }

  const scopeArg = optionArgs.find((arg) => arg.startsWith('--scope='));
  const scope = scopeArg ? scopeArg.slice('--scope='.length) : 'all';
  const firstOnly = optionArgs.includes('--first');
  const rootDirectory = resolve(process.cwd());
  const packageManager = detectPackageManager();

  const workspaces = listWorkspaceDirectories(rootDirectory, scope).filter((directory) => hasScript(directory, scriptName));

  if (firstOnly) {
    const firstWorkspace = workspaces[0];

    if (!firstWorkspace) {
      throw new Error(`No workspace with script "${scriptName}" was found for scope "${scope}".`);
    }

    runScript(firstWorkspace, packageManager, scriptName);
    return;
  }

  for (const workspace of workspaces) {
    runScript(workspace, packageManager, scriptName);
  }
}

main();
