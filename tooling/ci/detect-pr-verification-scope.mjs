#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');

const alwaysFullVerifyPrefixes = [
  '.github/',
  'docs/',
  'tooling/',
  'examples/',
  'apps/',
];

const alwaysFullVerifyPaths = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.tools.json',
  'vitest.config.ts',
  'biome.json',
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`);
  }

  return result;
}

function parseWorkspaceGlobs() {
  const workspaceFile = join(repoRoot, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) {
    return [];
  }

  const content = readFileSync(workspaceFile, 'utf8');
  const matches = [...content.matchAll(/^\s+-\s+['"]?([^'"#\n]+?)['"]?\s*$/gm)];
  return matches.map((match) => match[1].trim());
}

function collectWorkspaceManifests() {
  const manifests = [];
  const workspaceGlobs = parseWorkspaceGlobs();

  for (const workspace of workspaceGlobs) {
    const [segment] = workspace.split('/');
    const parentDirectory = join(repoRoot, segment);

    if (!existsSync(parentDirectory)) {
      continue;
    }

    for (const entry of readdirSync(parentDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspaceDirectory = join(parentDirectory, entry.name);
      const manifestPath = join(workspaceDirectory, 'package.json');
      if (!existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
        continue;
      }

      manifests.push({
        directory: `${segment}/${entry.name}`,
        name: manifest.name,
        manifest,
      });
    }
  }

  return manifests;
}

function collectLocalDependencies(manifest, workspaceNames) {
  const dependencySections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];

  const dependencies = new Set();
  for (const section of dependencySections) {
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

  return dependencies;
}

function readPrLabels() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) {
    return [];
  }

  const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  const labels = payload?.pull_request?.labels;
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels
    .map((label) => label?.name)
    .filter((name) => typeof name === 'string');
}

function changedFilesFromGit() {
  const baseBranch = process.env.GITHUB_BASE_REF || 'main';
  const preferredBase = `origin/${baseBranch}`;
  const mergeBaseResult = run('git', ['merge-base', 'HEAD', preferredBase], { allowFailure: true });

  if (mergeBaseResult.status !== 0 || mergeBaseResult.stdout.trim().length === 0) {
    return {
      ok: false,
      reason: `unable to compute merge-base with ${preferredBase}`,
      files: [],
    };
  }

  const mergeBase = mergeBaseResult.stdout.trim();
  const diffResult = run('git', ['diff', '--name-only', `${mergeBase}...HEAD`], { allowFailure: true });

  if (diffResult.status !== 0) {
    return {
      ok: false,
      reason: 'unable to compute changed files from git diff',
      files: [],
    };
  }

  const files = diffResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    ok: true,
    reason: files.length === 0 ? 'no changed files detected; running full verification for safety' : 'changed files detected',
    files,
  };
}

export function shouldForceFullVerificationByPath(changedFiles) {
  for (const path of changedFiles) {
    if (alwaysFullVerifyPaths.has(path)) {
      return `changed ${path}`;
    }

    if (alwaysFullVerifyPrefixes.some((prefix) => path.startsWith(prefix))) {
      return `changed ${path}`;
    }

    if (path === 'README.md' || path === 'README.ko.md' || path.endsWith('/README.md') || path.endsWith('/README.ko.md')) {
      return `changed public/docs surface file ${path}`;
    }

    if (!path.startsWith('packages/')) {
      return `changed non-package file ${path}`;
    }
  }

  return undefined;
}

export function resolveChangedPackageDirectories(changedFiles) {
  const directories = new Set();
  for (const path of changedFiles) {
    if (!path.startsWith('packages/')) {
      continue;
    }

    const [, packageDirectory] = path.split('/');
    if (packageDirectory) {
      directories.add(`packages/${packageDirectory}`);
    }
  }

  return directories;
}

export function resolveVerificationScope(changedFiles) {
  const fullVerifyReason = shouldForceFullVerificationByPath(changedFiles);
  if (fullVerifyReason) {
    return {
      mode: 'full',
      reason: `${fullVerifyReason}; cannot prove safe affected-only coverage`,
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  const workspaceManifests = collectWorkspaceManifests();
  const workspaceNames = new Set(workspaceManifests.map((manifest) => manifest.name));
  const manifestsByDirectory = new Map(workspaceManifests.map((entry) => [entry.directory, entry]));

  const changedDirectories = resolveChangedPackageDirectories(changedFiles);
  if (changedDirectories.size === 0) {
    return {
      mode: 'full',
      reason: 'no changed package directory detected; running full verification for safety',
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  const changedPackageNames = [];
  for (const directory of changedDirectories) {
    const manifest = manifestsByDirectory.get(directory);
    if (!manifest) {
      return {
        mode: 'full',
        reason: `unable to resolve workspace manifest for ${directory}`,
        filters: [],
        packageNames: [],
        packageDirectories: [],
      };
    }

    changedPackageNames.push(manifest.name);
  }

  const reverseDependents = new Map();
  for (const workspace of workspaceManifests) {
    const dependencies = collectLocalDependencies(workspace.manifest, workspaceNames);

    for (const dependencyName of dependencies) {
      const dependents = reverseDependents.get(dependencyName) ?? new Set();
      dependents.add(workspace.name);
      reverseDependents.set(dependencyName, dependents);
    }
  }

  const closure = new Set(changedPackageNames);
  const queue = [...changedPackageNames];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const dependents = reverseDependents.get(current);
    if (!dependents) {
      continue;
    }

    for (const dependent of dependents) {
      if (closure.has(dependent)) {
        continue;
      }

      closure.add(dependent);
      queue.push(dependent);
    }
  }

  const packageNames = [...closure].sort((left, right) => left.localeCompare(right));
  const directoryByPackageName = new Map(workspaceManifests.map((entry) => [entry.name, entry.directory]));
  const packageDirectories = packageNames
    .map((packageName) => directoryByPackageName.get(packageName))
    .filter((directory) => typeof directory === 'string')
    .sort((left, right) => left.localeCompare(right));
  const testScriptPackageNames = packageNames.filter((packageName) => {
    const directory = directoryByPackageName.get(packageName);
    const manifest = directory ? manifestsByDirectory.get(directory) : undefined;
    return typeof manifest?.manifest?.scripts?.test === 'string' && manifest.manifest.scripts.test.trim().length > 0;
  });
  const testPathFallbackDirectories = packageDirectories.filter((directory) => {
    const manifest = manifestsByDirectory.get(directory);
    return !(typeof manifest?.manifest?.scripts?.test === 'string' && manifest.manifest.scripts.test.trim().length > 0);
  });

  return {
    mode: 'scoped',
    reason: `scoped verification for ${packageNames.length} workspace package(s) from ${changedPackageNames.length} changed package(s)`,
    filters: packageNames.map((name) => `--filter=${name}`),
    packageNames,
    packageDirectories,
    testScriptPackageNames,
    testPathFallbackDirectories,
  };
}

export function collectResult() {
  if (process.env.CI_FORCE_FULL_VERIFY === '1') {
    return {
      mode: 'full',
      reason: 'CI_FORCE_FULL_VERIFY=1',
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== 'pull_request') {
    return {
      mode: 'full',
      reason: `event ${eventName ?? 'unknown'} requires full verification`,
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  const labels = readPrLabels();
  if (labels.includes('ci:full-verify')) {
    return {
      mode: 'full',
      reason: 'ci:full-verify label present',
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  const changedFilesResult = changedFilesFromGit();
  if (!changedFilesResult.ok) {
    return {
      mode: 'full',
      reason: changedFilesResult.reason,
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  if (changedFilesResult.files.length === 0) {
    return {
      mode: 'full',
      reason: changedFilesResult.reason,
      filters: [],
      packageNames: [],
      packageDirectories: [],
    };
  }

  return resolveVerificationScope(changedFilesResult.files);
}

export function writeGithubOutput(result) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) {
    return;
  }

  const lines = [
    `mode=${result.mode}`,
    `reason=${result.reason}`,
    `filter_args=${result.filters.join(' ')}`,
    `package_names=${result.packageNames.join(',')}`,
    `test_filter_args=${(result.testScriptPackageNames ?? []).map((name) => `--filter=${name}`).join(' ')}`,
    `test_package_names=${(result.testScriptPackageNames ?? []).join(',')}`,
    `test_paths=${(result.testPathFallbackDirectories ?? result.packageDirectories).join(' ')}`,
  ];
  lines.push(`is_scoped=${result.mode === 'scoped' ? 'true' : 'false'}`);

  const content = `${lines.join('\n')}\n`;
  appendFileSync(githubOutput, content, 'utf8');
}

export function main() {
  const result = collectResult();

  console.log(`[ci][verification-scope] mode=${result.mode}`);
  console.log(`[ci][verification-scope] reason=${result.reason}`);
  if (result.packageNames.length > 0) {
    console.log(`[ci][verification-scope] packages=${result.packageNames.join(', ')}`);
  }

  writeGithubOutput(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
