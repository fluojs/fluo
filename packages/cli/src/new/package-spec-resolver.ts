import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ResolvedBootstrapPlan } from './resolver.js';
import type { BootstrapOptions } from './types.js';

const LOCAL_PACKAGE_CACHE_DIR = join(tmpdir(), 'fluo-cli-local-packages');
const LOCAL_PACKAGE_CACHE_STAMP_FILE = 'cache-stamp.json';
const LOCAL_PACKAGE_CACHE_FORMAT_VERSION = 2;

type LocalPackageCacheStamp = {
  cacheFormatVersion: number;
  dirtyFingerprint: string;
  headCommit: string;
  packageVersions: Record<string, string>;
};

type LocalPackageManifest = {
  dependencies?: Record<string, string>;
  name: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version: string;
};

type LocalPackage = {
  directory: string;
  manifest: LocalPackageManifest;
};

type LocalPackagesByName = ReadonlyMap<string, LocalPackage>;

function expectedTarballName(packageName: string, version: string): string {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

function collectLocalPackages(repoRoot: string): LocalPackagesByName {
  const packagesByName = new Map<string, LocalPackage>();
  const packagesRoot = join(repoRoot, 'packages');

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    const packageJsonPath = join(packagesRoot, entry.name, 'package.json');

    if (!entry.isDirectory() || !existsSync(packageJsonPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as LocalPackageManifest;

    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      continue;
    }

    packagesByName.set(manifest.name, { directory: entry.name, manifest });
  }

  return packagesByName;
}

function collectRequiredLocalPackages(
  localPackages: LocalPackagesByName,
  bootstrapPlan: ResolvedBootstrapPlan,
): readonly string[] {
  const pending = [
    ...bootstrapPlan.dependencies.dependencies,
    ...bootstrapPlan.dependencies.devDependencies,
  ].filter((packageName) => localPackages.has(packageName));
  const selected = new Set<string>();

  while (pending.length > 0) {
    const packageName = pending.pop();

    if (!packageName || selected.has(packageName)) {
      continue;
    }

    selected.add(packageName);
    const manifest = localPackages.get(packageName)?.manifest;

    if (!manifest) {
      continue;
    }

    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      for (const dependencyName of Object.keys(manifest[section] ?? {})) {
        if (localPackages.has(dependencyName)) {
          pending.push(dependencyName);
        }
      }
    }
  }

  return Array.from(selected);
}

function collectLocalPackageVersions(
  localPackages: LocalPackagesByName,
  packageNames: readonly string[],
): Map<string, string> {
  return new Map(packageNames.map((packageName) => [packageName, localPackages.get(packageName)!.manifest.version]));
}

function getPackageVersionOrThrow(
  packageVersions: ReadonlyMap<string, string>,
  packageName: string,
): string {
  const packageVersion = packageVersions.get(packageName);

  if (!packageVersion) {
    throw new Error(`Unable to determine version for ${packageName}.`);
  }

  return packageVersion;
}

function toPackageVersionRecord(
  packageVersions: ReadonlyMap<string, string>,
): Record<string, string> {
  const packageVersionRecord: Record<string, string> = {};

  for (const [packageName, packageVersion] of packageVersions.entries()) {
    packageVersionRecord[packageName] = packageVersion;
  }

  return packageVersionRecord;
}

function runGitCommand(repoRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function createPackagePathArguments(
  localPackages: LocalPackagesByName,
  packageNames: readonly string[],
): string[] {
  const packagePaths = new Set<string>();

  for (const packageName of packageNames) {
    const packageDirectory = localPackages.get(packageName)!.directory;
    const packageRoot = join('packages', packageDirectory);
    packagePaths.add(packageRoot);
    packagePaths.add(join(packageRoot, 'src'));
    packagePaths.add(join(packageRoot, 'package.json'));
    packagePaths.add(join(packageRoot, 'tsconfig.json'));
    packagePaths.add(join(packageRoot, 'tsconfig.build.json'));
  }

  return Array.from(packagePaths);
}

function copyIfExists(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }

  cpSync(sourcePath, destinationPath, { recursive: true });
}

function collectPackageStagePaths(
  packageRoot: string,
  manifest: {
    bin?: Record<string, string> | string;
    files?: string[];
    main?: string;
    types?: string;
  },
): string[] {
  const stagePaths = new Set<string>();

  for (const fixedPath of ['README.md', 'README.ko.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    if (existsSync(join(packageRoot, fixedPath))) {
      stagePaths.add(fixedPath);
    }
  }

  for (const fileEntry of manifest.files ?? []) {
    if (existsSync(join(packageRoot, fileEntry))) {
      stagePaths.add(fileEntry);
    }
  }

  if (typeof manifest.bin === 'string') {
    stagePaths.add(manifest.bin);
  } else if (manifest.bin) {
    for (const binPath of Object.values(manifest.bin)) {
      stagePaths.add(binPath);
    }
  }

  if (manifest.main) {
    stagePaths.add(manifest.main);
  }

  if (manifest.types) {
    stagePaths.add(manifest.types);
  }

  return Array.from(stagePaths);
}

function stagePackageForPacking(
  repoRoot: string,
  localPackages: LocalPackagesByName,
  packageName: string,
  packageVersions: ReadonlyMap<string, string>,
  outputDirectory: string,
): string {
  const packageDirectory = localPackages.get(packageName)!.directory;
  const packageRoot = join(repoRoot, 'packages', packageDirectory);
  const stageDirectory = join(outputDirectory, `.stage-${packageDirectory}`);
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    bin?: Record<string, string> | string;
    dependencies?: Record<string, string>;
    files?: string[];
    main?: string;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    types?: string;
  };

  rmSync(stageDirectory, { force: true, recursive: true });
  mkdirSync(stageDirectory, { recursive: true });

  for (const relativePath of collectPackageStagePaths(packageRoot, manifest)) {
    copyIfExists(join(packageRoot, relativePath), join(stageDirectory, relativePath));
  }

  rewriteWorkspaceProtocolDependencies(manifest, packageVersions);
  writeFileSync(join(stageDirectory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return stageDirectory;
}

function computeLocalPackageCacheStamp(
  repoRoot: string,
  localPackages: LocalPackagesByName,
  packageNames: readonly string[],
  packageVersions: ReadonlyMap<string, string>,
): LocalPackageCacheStamp | undefined {
  const headCommit = runGitCommand(repoRoot, ['rev-parse', 'HEAD']);

  if (!headCommit) {
    return undefined;
  }

  const packagePaths = createPackagePathArguments(localPackages, packageNames);
  const dirtyFingerprint = runGitCommand(repoRoot, ['status', '--porcelain', '--', ...packagePaths]);

  if (dirtyFingerprint === undefined) {
    return undefined;
  }

  return {
    cacheFormatVersion: LOCAL_PACKAGE_CACHE_FORMAT_VERSION,
    dirtyFingerprint,
    headCommit,
    packageVersions: toPackageVersionRecord(packageVersions),
  };
}

function readLocalPackageCacheStamp(stampPath: string): LocalPackageCacheStamp | undefined {
  if (!existsSync(stampPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(stampPath, 'utf8')) as LocalPackageCacheStamp;
  } catch {
    return undefined;
  }
}

function cacheStampMatches(expected: LocalPackageCacheStamp, actual: LocalPackageCacheStamp | undefined): boolean {
  if (!actual) {
    return false;
  }

  if (actual.cacheFormatVersion !== LOCAL_PACKAGE_CACHE_FORMAT_VERSION) {
    return false;
  }

  if (actual.headCommit !== expected.headCommit || actual.dirtyFingerprint !== expected.dirtyFingerprint) {
    return false;
  }

  for (const [packageName, packageVersion] of Object.entries(expected.packageVersions)) {
    if (actual.packageVersions[packageName] !== packageVersion) {
      return false;
    }
  }

  return true;
}

function cacheContainsTarballs(
  outputDirectory: string,
  packageNames: readonly string[],
  packageVersions: ReadonlyMap<string, string>,
): boolean {
  const packedFiles = new Set(readdirSync(outputDirectory));

  return packageNames.every((packageName) => {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarball = expectedTarballName(packageName, packageVersion);
    return packedFiles.has(tarball);
  });
}

function clearLocalPackageCacheArtifacts(outputDirectory: string): void {
  if (!existsSync(outputDirectory)) {
    return;
  }

  for (const entry of readdirSync(outputDirectory, { withFileTypes: true })) {
    if (entry.name === LOCAL_PACKAGE_CACHE_STAMP_FILE) {
      continue;
    }

    if (entry.isDirectory() || entry.name.endsWith('.tgz')) {
      rmSync(join(outputDirectory, entry.name), { force: true, recursive: true });
    }
  }
}

function createLocalPackageCachePath(repoRoot: string): string {
  const repoCacheKey = createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 12);
  return join(LOCAL_PACKAGE_CACHE_DIR, repoCacheKey);
}

function latestModifiedTimeMs(path: string): number {
  const stats = statSync(path);

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    latest = Math.max(latest, latestModifiedTimeMs(entryPath));
  }

  return latest;
}

function packageHasOutdatedBuildOutput(
  repoRoot: string,
  localPackages: LocalPackagesByName,
  packageName: string,
): boolean {
  const packageDirectory = localPackages.get(packageName)!.directory;
  const packageRoot = join(repoRoot, 'packages', packageDirectory);
  const distDirectory = join(packageRoot, 'dist');

  if (!existsSync(distDirectory)) {
    return true;
  }

  const sourceCandidates = [
    join(packageRoot, 'src'),
    join(packageRoot, 'package.json'),
    join(packageRoot, 'tsconfig.json'),
    join(packageRoot, 'tsconfig.build.json'),
  ];
  let latestSource = 0;

  for (const sourceCandidate of sourceCandidates) {
    if (!existsSync(sourceCandidate)) {
      continue;
    }

    latestSource = Math.max(latestSource, latestModifiedTimeMs(sourceCandidate));
  }

  const latestDist = latestModifiedTimeMs(distDirectory);
  return latestDist < latestSource;
}

function shouldRunWorkspaceBuild(
  repoRoot: string,
  localPackages: LocalPackagesByName,
  packageNames: readonly string[],
): boolean {
  return packageNames.some((packageName) => packageHasOutdatedBuildOutput(repoRoot, localPackages, packageName));
}

function runPackCommand(packageDirectory: string, outputDirectory: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', ['pack', '--pack-destination', outputDirectory], {
      cwd: packageDirectory,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`Failed to pack ${packageDirectory} with exit code ${code}.`));
    });
  });
}

function runWorkspaceBuild(repoRoot: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('pnpm', ['build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`Failed to build workspace with exit code ${code}.`));
    });
  });
}

async function ensureWorkspaceBuildOutput(
  repoRoot: string,
  localPackages: LocalPackagesByName,
  packageNames: readonly string[],
): Promise<void> {
  if (shouldRunWorkspaceBuild(repoRoot, localPackages, packageNames)) {
    await runWorkspaceBuild(repoRoot);
  }
}

async function packLocalPackages(
  repoRoot: string,
  localPackages: LocalPackagesByName,
  outputDirectory: string,
  packageNames: readonly string[],
  packageVersions: ReadonlyMap<string, string>,
): Promise<void> {
  for (const packageName of packageNames) {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarballName = expectedTarballName(packageName, packageVersion);

    const stageDirectory = stagePackageForPacking(repoRoot, localPackages, packageName, packageVersions, outputDirectory);

    try {
      await runPackCommand(stageDirectory, outputDirectory);
    } finally {
      rmSync(stageDirectory, { force: true, recursive: true });
    }

    if (!existsSync(join(outputDirectory, tarballName))) {
      throw new Error(`Unable to locate packed tarball for ${packageName}.`);
    }
  }
}

function createLocalTarballSpecs(
  outputDirectory: string,
  packageNames: readonly string[],
  packageVersions: ReadonlyMap<string, string>,
): Record<string, string> {
  const packedFiles = new Set(readdirSync(outputDirectory));
  const tarballs = new Map<string, string>();

  for (const packageName of packageNames) {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarball = expectedTarballName(packageName, packageVersion);

    if (!packedFiles.has(tarball)) {
      throw new Error(`Unable to locate packed tarball for ${packageName}.`);
    }

    tarballs.set(packageName, `file:${join(outputDirectory, tarball)}`);
  }

  return Object.fromEntries(tarballs);
}

function rewriteWorkspaceProtocolSpecifier(specifier: string, version: string): string {
  const workspaceRange = specifier.slice('workspace:'.length);

  if (workspaceRange === '^') {
    return `^${version}`;
  }

  if (workspaceRange === '~') {
    return `~${version}`;
  }

  if (workspaceRange === '*' || workspaceRange.length === 0) {
    return version;
  }

  return workspaceRange;
}

function rewriteWorkspaceProtocolDependencies(
  manifest: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  },
  packageVersions: ReadonlyMap<string, string>,
): void {
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const dependencies = manifest[section];

    if (!dependencies) {
      continue;
    }

    for (const [packageName, specifier] of Object.entries(dependencies)) {
      if (!specifier.startsWith('workspace:')) {
        continue;
      }

      const version = packageVersions.get(packageName);

      if (!version) {
        continue;
      }

      dependencies[packageName] = rewriteWorkspaceProtocolSpecifier(specifier, version);
    }
  }
}

/**
 * Resolve package specs.
 *
 * @param options The options.
 * @param bootstrapPlan The bootstrap plan.
 * @returns The resolve package specs result.
 */
export async function resolvePackageSpecs(
  options: BootstrapOptions,
  bootstrapPlan: ResolvedBootstrapPlan,
): Promise<Record<string, string>> {
  if (options.dependencySource !== 'local' || !options.repoRoot) {
    return {};
  }

  const repoRoot = resolve(options.repoRoot);
  const outputDirectory = createLocalPackageCachePath(repoRoot);
  const cacheStampPath = join(outputDirectory, LOCAL_PACKAGE_CACHE_STAMP_FILE);
  mkdirSync(outputDirectory, { recursive: true });

  const localPackages = collectLocalPackages(repoRoot);
  const packageNames = collectRequiredLocalPackages(localPackages, bootstrapPlan);
  const packageVersions = collectLocalPackageVersions(localPackages, packageNames);
  const expectedCacheStamp = computeLocalPackageCacheStamp(repoRoot, localPackages, packageNames, packageVersions);
  const currentCacheStamp = readLocalPackageCacheStamp(cacheStampPath);
  const canReuseCachedTarballs = expectedCacheStamp
    ? cacheStampMatches(expectedCacheStamp, currentCacheStamp)
      && cacheContainsTarballs(outputDirectory, packageNames, packageVersions)
    : false;

  if (!canReuseCachedTarballs) {
    await ensureWorkspaceBuildOutput(repoRoot, localPackages, packageNames);
    clearLocalPackageCacheArtifacts(outputDirectory);
    await packLocalPackages(repoRoot, localPackages, outputDirectory, packageNames, packageVersions);

    if (expectedCacheStamp) {
      writeFileSync(cacheStampPath, `${JSON.stringify(expectedCacheStamp, null, 2)}\n`, 'utf8');
    } else {
      rmSync(cacheStampPath, { force: true });
    }
  }

  return createLocalTarballSpecs(outputDirectory, packageNames, packageVersions);
}
