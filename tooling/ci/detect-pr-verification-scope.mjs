#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const defaultScope = JSON.parse(readFileSync(new URL('./local-verification-manifest.json', import.meta.url), 'utf8')).scope;

export function isProsePath(path) {
  // MDX, fixtures, generated source and enforcement scripts are executable.
  return /(?:^|\/)(?:README(?:\.ko)?|CONTRIBUTING(?:\.ko)?)\.md$/u.test(path)
    || /^(?:docs|book)\/.*\.(?:md|png|jpg|svg|webp)$/u.test(path)
    || /^\.changeset\/[^/]+\.md$/u.test(path);
}

export function shouldForceFullVerificationByPath(changedFiles, scope = defaultScope) {
  for (const path of changedFiles) {
    if (isProsePath(path)) continue;
    if (path === 'package.json' || path.endsWith('/package.json')
      || /(?:global[-_]?setup|(?:^|\/)(?:tsconfig|vitest\.config|vite\.config))/u.test(path)
      || scope.fullPaths.includes(path) || scope.fullPrefixes.some((prefix) => path.startsWith(prefix))) {
      return `changed graph or global verification input ${path}`;
    }
  }
  return undefined;
}

export function readWorkspaceGraph(root = repoRoot) {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const block = yaml.match(/^packages:\s*\n((?:[ \t]+.*\n?)*)/mu)?.[1];
  if (!block) throw new TypeError('workspace packages are missing');
  const globs = block.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
    const match = line.match(/^\s+-\s+['"]?([^'"#]+?)['"]?\s*$/u);
    if (!match || match[1].includes('..') || match[1].startsWith('/')) throw new TypeError('unknown workspace glob');
    return match[1];
  });
  const excluded = globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  const paths = new Set(globs.filter((glob) => !glob.startsWith('!')).flatMap((glob) =>
    globSync(`${glob}/package.json`, { cwd: root, exclude: excluded.map((glob) => `${glob}/**`) })));
  if (!paths.size) throw new TypeError('workspace inventory is empty');
  const entries = [...paths].sort().map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'));
    if (typeof manifest.name !== 'string' || !manifest.name) throw new TypeError(`unnamed workspace ${path}`);
    return { directory: dirname(path), name: manifest.name, manifest };
  });
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const byDirectory = new Map(entries.map((entry) => [entry.directory, entry]));
  if (byName.size !== entries.length) throw new TypeError('duplicate workspace name');
  for (const entry of entries) {
    const dependencies = new Set();
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(entry.manifest[section] ?? {})) {
        if (typeof version !== 'string') throw new TypeError(`invalid dependency ${name}`);
        let target = byName.get(name);
        if (/^(?:file|link):/u.test(version) || version.startsWith('workspace:.')) {
          const directory = relative(root, resolve(root, entry.directory, version.slice(version.indexOf(':') + 1)));
          target = byDirectory.get(directory);
          if (!target) throw new TypeError(`unresolved local dependency ${version}`);
        } else if (/^(?:workspace|npm):(?:@[^/]+\/)?[^@]+@/u.test(version)) {
          const alias = version.slice(version.indexOf(':') + 1).replace(/@[^@]*$/u, '');
          target = byName.get(alias);
          if (!target && version.startsWith('workspace:')) throw new TypeError(`unresolved workspace alias ${version}`);
        }
        if (target) dependencies.add(target.name);
        else if (version.startsWith('workspace:')) throw new TypeError(`unresolved workspace ${name}`);
      }
    }
    entry.dependencies = [...dependencies].sort();
  }
  return { entries, digest: hash(JSON.stringify(entries)) };
}

export function resolveVerificationScope(changedFiles, { root = repoRoot, scope = defaultScope, forceFull = false } = {}) {
  const full = (reason) => ({ mode: 'full', reason, filters: [], buildFilters: [], packageNames: [],
    packageDirectories: [], buildDirectories: [], graphDigest: null, tasks: [], toolingPaths: [], typecheckNames: [] });
  if (forceFull) return full('explicit full verification request');
  if (!changedFiles.length) return full('no changed paths');
  const global = shouldForceFullVerificationByPath(changedFiles, scope);
  if (global) return full(global);
  if (changedFiles.every(isProsePath)) return { ...full('prose/documentation changes'), mode: 'docs' };
  let graph;
  try { graph = readWorkspaceGraph(root); }
  catch (error) { return full(`unknown workspace graph: ${error.message}`); }
  const byName = new Map(graph.entries.map((entry) => [entry.name, entry]));
  const affected = new Set();
  for (const path of changedFiles.filter((file) => !isProsePath(file))) {
    const owner = graph.entries.filter((entry) => path.startsWith(`${entry.directory}/`))
      .sort((a, b) => b.directory.length - a.directory.length)[0];
    if (!owner) return full(`unknown workspace owner: ${path}`);
    affected.add(owner.name);
  }
  const expandReverse = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of graph.entries) {
        if (!affected.has(entry.name) && entry.dependencies.some((name) => affected.has(name))) {
          affected.add(entry.name);
          changed = true;
        }
      }
    }
  };
  expandReverse();
  const tasks = new Set();
  const toolingPaths = new Set();
  const extraBuilds = new Set();
  let previous;
  do {
    previous = affected.size;
    for (const edge of scope.companionEdges ?? []) {
      if (!edge.owners.some((name) => affected.has(name))) continue;
      for (const name of edge.consumers ?? []) {
        if (!byName.has(name)) return full(`unknown companion workspace ${name}`);
        affected.add(name);
      }
      for (const task of edge.tasks ?? []) tasks.add(task);
      for (const path of edge.toolingPaths ?? []) toolingPaths.add(path);
      for (const name of edge.buildPackages ?? []) extraBuilds.add(name);
    }
    expandReverse();
  } while (previous !== affected.size);
  // The packed inventory authenticates every published package, not only seeds.
  if (tasks.has('packed') || tasks.has('starters') || toolingPaths.size
    || [...affected].some((name) => byName.get(name).directory.startsWith('tooling/'))) {
    for (const entry of graph.entries.filter((entry) => entry.directory.startsWith('packages/'))) extraBuilds.add(entry.name);
  }
  const builds = new Set([...affected, ...extraBuilds]);
  for (const name of builds) {
    if (!byName.has(name)) return full(`unknown build companion ${name}`);
    for (const dependency of byName.get(name).dependencies) builds.add(dependency);
  }
  const packageNames = [...affected].sort();
  const packageDirectories = packageNames.map((name) => byName.get(name).directory).sort();
  const typecheckNames = packageNames.filter((name) => {
    const entry = byName.get(name);
    return entry.manifest.scripts?.typecheck && (!entry.directory.startsWith('examples/') || entry.directory === 'examples/react-vite-ssr');
  });
  const buildDirectories = [...builds].map((name) => byName.get(name))
    .filter((entry) => entry.manifest.scripts?.build && entry.directory.startsWith('packages/'))
    .map((entry) => entry.directory).sort();
  return { mode: 'scoped', reason: 'workspace reverse dependents and explicit companion closure',
    filters: packageNames.map((name) => `--filter=${name}`),
    buildFilters: buildDirectories.map((directory) => `--filter=${graph.entries.find((entry) => entry.directory === directory).name}`),
    packageNames, packageDirectories, buildDirectories, graphDigest: graph.digest, typecheckNames,
    tasks: [...tasks].sort(), toolingPaths: [...toolingPaths].sort() };
}

export const shouldVerifyIsolatedHttpBenchmark = (files) => files.some((path) => path.startsWith('tooling/benchmarks/http-comparison/'));
export const shouldVerifyReactAppBenchmark = (files) => files.some((path) => path.startsWith('tooling/benchmarks/react-app-comparison/'));
export const resolveChangedPackageDirectories = (files) => new Set(files.filter((path) => path.startsWith('packages/')).map((path) => path.split('/').slice(0, 2).join('/')));

export function fullVerificationRequested(env = process.env) {
  if (env.CI_FORCE_FULL_VERIFY === '1') return true;
  if (!env.GITHUB_EVENT_PATH) return false;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  return event.pull_request?.labels?.some((label) => label.name === 'ci:full-verify') === true;
}

export function collectResult() {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const base = run(['merge-base', 'HEAD', `origin/${process.env.GITHUB_BASE_REF || 'main'}`]);
  const files = run(['diff', '--name-only', '--no-renames', `${base}...HEAD`]).split('\n').filter(Boolean);
  return { ...resolveVerificationScope(files, { forceFull: fullVerificationRequested() || process.env.GITHUB_EVENT_NAME !== 'pull_request' }),
    verifyIsolatedHttpBenchmark: shouldVerifyIsolatedHttpBenchmark(files), verifyReactAppBenchmark: shouldVerifyReactAppBenchmark(files) };
}

export function writeGithubOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nreason=${result.reason}\nfilter_args=${result.filters.join(' ')}\nbuild_filter_args=${result.buildFilters.join(' ')}\n`);
}

export function main() {
  const result = collectResult();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  writeGithubOutput(result);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
