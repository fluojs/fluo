import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ResolvedBootstrapPlan } from './resolver.js';
import type { BootstrapOptions } from './types.js';

const PACKAGE_DIRECTORY_BY_NAME = {
  '@fluojs/platform-bun': 'platform-bun',
  '@fluojs/cli': 'cli',
  '@fluojs/config': 'config',
  '@fluojs/core': 'core',
  '@fluojs/di': 'di',
  '@fluojs/http': 'http',
  '@fluojs/platform-cloudflare-workers': 'platform-cloudflare-workers',
  '@fluojs/platform-deno': 'platform-deno',
  '@fluojs/microservices': 'microservices',
  '@fluojs/platform-express': 'platform-express',
  '@fluojs/platform-fastify': 'platform-fastify',
  '@fluojs/platform-nodejs': 'platform-nodejs',
  '@fluojs/runtime': 'runtime',
  '@fluojs/testing': 'testing',
  '@fluojs/validation': 'validation',
} as const;

const LOCAL_PACKAGE_CACHE_DIR = join(tmpdir(), 'fluo-cli-local-packages');
const LOCAL_PACKAGE_CACHE_STAMP_FILE = 'cache-stamp.json';
const LOCAL_PACKAGE_CACHE_FORMAT_VERSION = 2;

type LocalPackageName = keyof typeof PACKAGE_DIRECTORY_BY_NAME;

type LocalPackageCacheStamp = {
  cacheFormatVersion: number;
  dirtyFingerprint: string;
  headCommit: string;
  packageVersions: Partial<Record<LocalPackageName, string>>;
};

function expectedTarballName(packageName: string, version: string): string {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

function readLocalPackageVersion(repoRoot: string, packageName: LocalPackageName): string {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
  ) as { version: string };

  return packageJson.version;
}

function readLocalPackageManifest(
  repoRoot: string,
  packageName: LocalPackageName,
): {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
  return JSON.parse(
    readFileSync(join(repoRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

function collectRequiredLocalPackages(
  repoRoot: string,
  bootstrapPlan: ResolvedBootstrapPlan,
): readonly LocalPackageName[] {
  const pending = [
    ...bootstrapPlan.dependencies.dependencies,
    ...bootstrapPlan.dependencies.devDependencies,
  ].filter((packageName): packageName is LocalPackageName => packageName in PACKAGE_DIRECTORY_BY_NAME);
  const selected = new Set<LocalPackageName>();

  while (pending.length > 0) {
    const packageName = pending.pop();

    if (!packageName || selected.has(packageName)) {
      continue;
    }

    selected.add(packageName);
    const manifest = readLocalPackageManifest(repoRoot, packageName);

    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      const dependencies = manifest[section];

      if (!dependencies) {
        continue;
      }

      for (const dependencyName of Object.keys(dependencies)) {
        if (dependencyName in PACKAGE_DIRECTORY_BY_NAME) {
          pending.push(dependencyName as LocalPackageName);
        }
      }
    }
  }

  return Array.from(selected);
}

function collectLocalPackageVersions(repoRoot: string, packageNames: readonly LocalPackageName[]): Map<LocalPackageName, string> {
  const packageVersions = new Map<LocalPackageName, string>();

  for (const packageName of packageNames) {
    packageVersions.set(packageName, readLocalPackageVersion(repoRoot, packageName));
  }

  return packageVersions;
}

function getPackageVersionOrThrow(
  packageVersions: ReadonlyMap<LocalPackageName, string>,
  packageName: LocalPackageName,
): string {
  const packageVersion = packageVersions.get(packageName);

  if (!packageVersion) {
    throw new Error(`Unable to determine version for ${packageName}.`);
  }

  return packageVersion;
}

function toPackageVersionRecord(
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): Partial<Record<LocalPackageName, string>> {
  const packageVersionRecord: Partial<Record<LocalPackageName, string>> = {};

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

function createPackagePathArguments(packageNames: readonly LocalPackageName[]): string[] {
  const packagePaths = new Set<string>();

  for (const packageName of packageNames) {
    const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
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
  packageName: LocalPackageName,
  packageVersions: ReadonlyMap<string, string>,
  outputDirectory: string,
): string {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
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
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): LocalPackageCacheStamp | undefined {
  const headCommit = runGitCommand(repoRoot, ['rev-parse', 'HEAD']);

  if (!headCommit) {
    return undefined;
  }

  const packagePaths = createPackagePathArguments(packageNames);
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

  for (const [packageName, packageVersion] of Object.entries(expected.packageVersions) as [LocalPackageName, string][]) {
    if (actual.packageVersions[packageName] !== packageVersion) {
      return false;
    }
  }

  return true;
}

function cacheContainsTarballs(
  outputDirectory: string,
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
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

function packageHasOutdatedBuildOutput(repoRoot: string, packageName: LocalPackageName): boolean {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
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

function shouldRunWorkspaceBuild(repoRoot: string, packageNames: readonly LocalPackageName[]): boolean {
  return packageNames.some((packageName) => packageHasOutdatedBuildOutput(repoRoot, packageName));
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

async function ensureWorkspaceBuildOutput(repoRoot: string, packageNames: readonly LocalPackageName[]): Promise<void> {
  if (shouldRunWorkspaceBuild(repoRoot, packageNames)) {
    await runWorkspaceBuild(repoRoot);
  }
}

async function packLocalPackages(
  repoRoot: string,
  outputDirectory: string,
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): Promise<void> {
  for (const packageName of packageNames) {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarballName = expectedTarballName(packageName, packageVersion);

    const stageDirectory = stagePackageForPacking(repoRoot, packageName, packageVersions, outputDirectory);

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
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
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

  const packageNames = collectRequiredLocalPackages(repoRoot, bootstrapPlan);
  const packageVersions = collectLocalPackageVersions(repoRoot, packageNames);
  const expectedCacheStamp = computeLocalPackageCacheStamp(repoRoot, packageNames, packageVersions);
  const currentCacheStamp = readLocalPackageCacheStamp(cacheStampPath);
  const canReuseCachedTarballs = expectedCacheStamp
    ? cacheStampMatches(expectedCacheStamp, currentCacheStamp)
      && cacheContainsTarballs(outputDirectory, packageNames, packageVersions)
    : false;

  if (!canReuseCachedTarballs) {
    await ensureWorkspaceBuildOutput(repoRoot, packageNames);
    clearLocalPackageCacheArtifacts(outputDirectory);
    await packLocalPackages(repoRoot, outputDirectory, packageNames, packageVersions);

    if (expectedCacheStamp) {
      writeFileSync(cacheStampPath, `${JSON.stringify(expectedCacheStamp, null, 2)}\n`, 'utf8');
    } else {
      rmSync(cacheStampPath, { force: true });
    }
  }

  return createLocalTarballSpecs(outputDirectory, packageNames, packageVersions);
}
