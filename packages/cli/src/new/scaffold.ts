import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

import { installDependencies } from './install.js';
import type { BootstrapOptions, PackageManager } from './types.js';

const PACKAGE_DIRECTORY_BY_NAME = {
  '@konekti/cli': 'cli',
  '@konekti/config': 'config',
  '@konekti/core': 'core',
  '@konekti/validation': 'validation',
  '@konekti/di': 'di',
  '@konekti/http': 'http',
  '@konekti/runtime': 'runtime',
  '@konekti/testing': 'testing',
} as const;

const PUBLISHED_DEV_DEPENDENCIES = {
  '@babel/cli': '^7.26.4',
  '@babel/core': '^7.26.10',
  '@babel/plugin-proposal-decorators': '^7.28.0',
  '@babel/preset-typescript': '^7.27.1',
  '@types/babel__core': '^7.20.5',
  '@types/node': '^22.13.10',
  tsx: '^4.20.4',
  typescript: '^5.8.2',
  vite: '^6.2.1',
  vitest: '^3.0.8',
} as const;

type LocalPackageName = keyof typeof PACKAGE_DIRECTORY_BY_NAME;

const LOCAL_PACKAGE_NAMES: readonly LocalPackageName[] = [
  '@konekti/cli',
  '@konekti/config',
  '@konekti/core',
  '@konekti/validation',
  '@konekti/di',
  '@konekti/http',
  '@konekti/runtime',
  '@konekti/testing',
];

const LOCAL_PACKAGE_CACHE_DIR = join(tmpdir(), 'konekti-cli-local-packages');
const LOCAL_PACKAGE_CACHE_STAMP_FILE = 'cache-stamp.json';

type LocalPackageCacheStamp = {
  dirtyFingerprint: string;
  headCommit: string;
  packageVersions: Record<LocalPackageName, string>;
};

function packageRootFromImportMeta(importMetaUrl: string): string {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..', '..');
}

function readOwnPackageVersion(importMetaUrl: string): string {
  const packageJson = JSON.parse(readFileSync(join(packageRootFromImportMeta(importMetaUrl), 'package.json'), 'utf8')) as {
    version: string;
  };

  return packageJson.version;
}

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function createDependencySpec(
  packageName: keyof typeof PACKAGE_DIRECTORY_BY_NAME,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): string {
  return packageSpecs[packageName] ?? `^${releaseVersion}`;
}

function createRunCommand(packageManager: PackageManager, command: string): string {
  switch (packageManager) {
    case 'npm':
      return `npm run ${command}`;
    case 'yarn':
      return `yarn ${command}`;
    default:
      return `pnpm ${command}`;
  }
}

function createExecCommand(packageManager: PackageManager, command: string): string {
  switch (packageManager) {
    case 'npm':
      return `npm exec -- ${command}`;
    case 'yarn':
      return `yarn ${command}`;
    default:
      return `pnpm exec ${command}`;
  }
}

function createProjectPackageJson(
  options: BootstrapOptions,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): string {
  const packageManagerField = options.packageManager === 'pnpm'
    ? { packageManager: 'pnpm@10.4.1' }
    : options.packageManager === 'yarn'
      ? { packageManager: 'yarn@1.22.22' }
      : {};
  const localOverrideConfig = Object.keys(packageSpecs).length
    ? {
        overrides: packageSpecs,
        resolutions: packageSpecs,
      }
    : {};

  return JSON.stringify(
    {
      name: options.projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: {
        node: '>=20.0.0',
      },
      ...packageManagerField,
      ...localOverrideConfig,
      scripts: {
        build: 'babel src --extensions .ts --out-dir dist --config-file ./babel.config.cjs && tsc -p tsconfig.build.json',
        dev: 'node --env-file=.env --watch --watch-preserve-output --import tsx src/main.ts',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      },
      dependencies: {
        '@konekti/config': createDependencySpec('@konekti/config', releaseVersion, packageSpecs),
        '@konekti/core': createDependencySpec('@konekti/core', releaseVersion, packageSpecs),
        '@konekti/validation': createDependencySpec('@konekti/validation', releaseVersion, packageSpecs),
        '@konekti/di': createDependencySpec('@konekti/di', releaseVersion, packageSpecs),
        '@konekti/http': createDependencySpec('@konekti/http', releaseVersion, packageSpecs),
        '@konekti/runtime': createDependencySpec('@konekti/runtime', releaseVersion, packageSpecs),
      },
      devDependencies: {
        '@konekti/cli': createDependencySpec('@konekti/cli', releaseVersion, packageSpecs),
        '@konekti/testing': createDependencySpec('@konekti/testing', releaseVersion, packageSpecs),
        ...PUBLISHED_DEV_DEPENDENCIES,
      },
    },
    null,
    2,
  );
}

function createProjectTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`;
}

function createProjectTsconfigBuild(): string {
  return `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist"
  },
  "exclude": ["src/**/*.test.ts"]
}
`;
}

function createBabelConfig(): string {
  return `module.exports = {
  ignore: ['src/**/*.test.ts'],
  presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
};
`;
}

function createVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';

import { konektiBabelDecoratorsPlugin } from '@konekti/testing/vitest';

export default defineConfig({
  plugins: [konektiBabelDecoratorsPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
`;
}

function createGitignore(): string {
  return `node_modules
dist
.konekti
.env
.env.local
coverage
`;
}

function createProjectReadme(options: BootstrapOptions): string {
  return `# ${options.projectName}

Generated by @konekti/cli.

- CORS: defaults to allowOrigin '*'; pass a \`cors\` option to \`runNodeApplication\` to restrict origins
- Observability: /health and /ready endpoints are included by default
- Runtime path: bootstrapApplication -> handler mapping -> dispatcher -> middleware -> guard -> interceptor -> controller

## Commands

- Dev: ${createRunCommand(options.packageManager, 'dev')}
- Build: ${createRunCommand(options.packageManager, 'build')}
- Typecheck: ${createRunCommand(options.packageManager, 'typecheck')}
- Test: ${createRunCommand(options.packageManager, 'test')}

## Generator example

- Repo generator: ${createExecCommand(options.packageManager, 'konekti g repo User')}

## Official generated testing templates

- \`src/health/*.test.ts\` — unit templates for the starter-owned health slice.
- \`src/app.test.ts\` — integration-style dispatch template for runtime + starter routes.
- \`src/app.e2e.test.ts\` — e2e-style template powered by \`createTestApp\` from \`@konekti/testing\`.
- \`${createExecCommand(options.packageManager, 'konekti g repo User')}\` also adds:
  - \`src/users/user.repo.test.ts\` (unit template)
  - \`src/users/user.repo.slice.test.ts\` (slice/integration template via \`createTestingModule\`)

Use unit templates for fast logic checks. Use slice/e2e templates when you need module wiring and route-level confidence.
`;
}

function createAppFile(): string {
  return `import { Global, Module } from '@konekti/core';
import { ConfigModule } from '@konekti/config';
import { createHealthModule } from '@konekti/runtime';

import { HealthModule } from './health/health.module';

const RuntimeHealthModule = createHealthModule();

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
    }),
    HealthModule,
    RuntimeHealthModule,
  ],
})
export class AppModule {}
`;
}

function createHealthResponseDtoFile(): string {
  return `export class HealthResponseDto {
  ok!: boolean;
  service!: string;
}
`;
}

function createHealthRepoFile(projectName: string): string {
  return `import type { HealthResponseDto } from './health.response.dto';

export class HealthRepo {
  findHealth(): HealthResponseDto {
    return {
      ok: true,
      service: ${JSON.stringify(projectName)},
    };
  }
}
`;
}

function createHealthRepoTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { HealthRepo } from './health.repo';

describe('HealthRepo', () => {
  it('returns health data', () => {
    const repo = new HealthRepo();
    expect(repo.findHealth()).toEqual({ ok: true, service: expect.any(String) });
  });
});
`;
}

function createHealthServiceFile(): string {
  return `import { Inject } from '@konekti/core';
import type { HealthResponseDto } from './health.response.dto';

import { HealthRepo } from './health.repo';

@Inject([HealthRepo])
export class HealthService {
  constructor(private readonly repo: HealthRepo) {}

  getHealth(): HealthResponseDto {
    return this.repo.findHealth();
  }
}
`;
}

function createHealthServiceTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { HealthService } from './health.service';
import { HealthRepo } from './health.repo';

class FakeHealthRepo {
  findHealth() {
    return { ok: true, service: 'test' };
  }
}

describe('HealthService', () => {
  it('delegates to the repo', () => {
    const service = new HealthService(new FakeHealthRepo() as HealthRepo);
    expect(service.getHealth()).toEqual({ ok: true, service: 'test' });
  });
});
`;
}

function createHealthControllerFile(): string {
  return `import { Inject } from '@konekti/core';
import { Controller, Get } from '@konekti/http';

import { HealthService } from './health.service';
import { HealthResponseDto } from './health.response.dto';

@Inject([HealthService])
@Controller('/health-info')
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get('/')
  getHealth(): HealthResponseDto {
    return this.service.getHealth();
  }
}
`;
}

function createHealthControllerTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

class FakeHealthService {
  getHealth() {
    return { ok: true, service: 'test' };
  }
}

describe('HealthController', () => {
  it('delegates to the service', () => {
    const controller = new HealthController(new FakeHealthService() as never);
    expect(controller.getHealth()).toEqual({ ok: true, service: 'test' });
  });
});
`;
}

function createHealthModuleFile(): string {
  return `import { Module } from '@konekti/core';

import { HealthController } from './health.controller';
import { HealthRepo } from './health.repo';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthRepo, HealthService],
})
export class HealthModule {}
`;
}

function createMainFile(): string {
  return `import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

const app = await KonektiFactory.create(AppModule, {});
await app.listen();
`;
}

function createAppTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';
import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('AppModule', () => {
  it('dispatches the runtime health and readiness routes', async () => {
    const app = await KonektiFactory.create(AppModule, {});
    const healthResponse = createResponse();
    const readyResponse = createResponse();

    await app.dispatch(createRequest('/health'), healthResponse);
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(healthResponse.body).toEqual({ status: 'ok' });
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('dispatches the health-info route', async () => {
    const app = await KonektiFactory.create(AppModule, {});
    const response = createResponse();

    await app.dispatch(createRequest('/health-info/'), response);

    expect(response.body).toEqual({ ok: true, service: expect.any(String) });

    await app.close();
  });
});
`;
}

function createAppE2eTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { createTestApp } from '@konekti/testing';

import { AppModule } from './app';

describe('AppModule e2e', () => {
  it('serves runtime and starter routes through createTestApp', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.dispatch({ method: 'GET', path: '/health' })).resolves.toMatchObject({
      body: { status: 'ok' },
      status: 200,
    });
    await expect(app.dispatch({ method: 'GET', path: '/ready' })).resolves.toMatchObject({
      body: { status: 'ready' },
      status: 200,
    });
    await expect(app.dispatch({ method: 'GET', path: '/health-info/' })).resolves.toMatchObject({
      body: { ok: true, service: expect.any(String) },
      status: 200,
    });

    await app.close();
  });
});
`;
}

function createEnvFile(): string {
  return `PORT=3000
`;
}

type ScaffoldFile = {
  content: string;
  path: string;
};

function buildScaffoldFiles(
  options: BootstrapOptions,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): ScaffoldFile[] {
  return [
    { content: createProjectPackageJson(options, releaseVersion, packageSpecs), path: 'package.json' },
    { content: createProjectReadme(options), path: 'README.md' },
    { content: createProjectTsconfig(), path: 'tsconfig.json' },
    { content: createProjectTsconfigBuild(), path: 'tsconfig.build.json' },
    { content: createBabelConfig(), path: 'babel.config.cjs' },
    { content: createVitestConfig(), path: 'vitest.config.ts' },
    { content: createGitignore(), path: '.gitignore' },
    { content: createEnvFile(), path: '.env' },
    { content: createAppFile(), path: 'src/app.ts' },
    { content: createMainFile(), path: 'src/main.ts' },
    { content: createHealthResponseDtoFile(), path: 'src/health/health.response.dto.ts' },
    { content: createHealthRepoFile(options.projectName), path: 'src/health/health.repo.ts' },
    { content: createHealthRepoTestFile(), path: 'src/health/health.repo.test.ts' },
    { content: createHealthServiceFile(), path: 'src/health/health.service.ts' },
    { content: createHealthServiceTestFile(), path: 'src/health/health.service.test.ts' },
    { content: createHealthControllerFile(), path: 'src/health/health.controller.ts' },
    { content: createHealthControllerTestFile(), path: 'src/health/health.controller.test.ts' },
    { content: createHealthModuleFile(), path: 'src/health/health.module.ts' },
    { content: createAppTestFile(), path: 'src/app.test.ts' },
    { content: createAppE2eTestFile(), path: 'src/app.e2e.test.ts' },
  ];
}

export async function scaffoldBootstrapApp(
  options: BootstrapOptions,
  importMetaUrl = import.meta.url,
): Promise<void> {
  const targetDirectory = resolve(options.targetDirectory);
  const releaseVersion = readOwnPackageVersion(importMetaUrl);
  const packageSpecs = await resolvePackageSpecs(options);

  mkdirSync(targetDirectory, { recursive: true });

  if (!options.force) {
    const existingFiles = readdirSync(targetDirectory);
    if (existingFiles.length > 0) {
      throw new Error(
        `Target directory "${targetDirectory}" is not empty. ` +
        'Remove the existing files or use --force to overwrite.',
      );
    }
  }

  for (const file of buildScaffoldFiles(options, releaseVersion, packageSpecs)) {
    writeTextFile(join(targetDirectory, file.path), file.content);
  }

  if (!options.skipInstall) {
    await installDependencies(targetDirectory, options.packageManager);
  }
}

function runPackCommand(repoRoot: string, packageDirectory: string, outputDirectory: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', ['pack', '--pack-destination', outputDirectory], {
      cwd: join(repoRoot, 'packages', packageDirectory),
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
): Record<LocalPackageName, string> {
  const packageVersionRecord = {} as Record<LocalPackageName, string>;

  for (const packageName of LOCAL_PACKAGE_NAMES) {
    packageVersionRecord[packageName] = getPackageVersionOrThrow(packageVersions, packageName);
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

  if (actual.headCommit !== expected.headCommit || actual.dirtyFingerprint !== expected.dirtyFingerprint) {
    return false;
  }

  for (const packageName of LOCAL_PACKAGE_NAMES) {
    if (actual.packageVersions[packageName] !== expected.packageVersions[packageName]) {
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

    await runPackCommand(repoRoot, PACKAGE_DIRECTORY_BY_NAME[packageName], outputDirectory);
    await normalizePackedPackageManifest(outputDirectory, tarballName, packageVersions);
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

      dependencies[packageName] = `^${version}`;
    }
  }
}

function runTarCommand(args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', args, {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`tar ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
}

async function normalizePackedPackageManifest(
  outputDirectory: string,
  tarballName: string,
  packageVersions: ReadonlyMap<string, string>,
): Promise<void> {
  const tarballPath = join(outputDirectory, tarballName);
  const temporaryDirectory = join(outputDirectory, `.tmp-${tarballName.replace(/\.tgz$/, '')}`);
  const packageJsonPath = join(temporaryDirectory, 'package', 'package.json');

  rmSync(temporaryDirectory, { force: true, recursive: true });
  mkdirSync(temporaryDirectory, { recursive: true });

  await runTarCommand(['-xzf', tarballPath, '-C', temporaryDirectory], outputDirectory);

  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  rewriteWorkspaceProtocolDependencies(manifest, packageVersions);
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  rmSync(tarballPath, { force: true });
  await runTarCommand(['-czf', tarballPath, '-C', temporaryDirectory, 'package'], outputDirectory);
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

async function resolvePackageSpecs(options: BootstrapOptions): Promise<Record<string, string>> {
  if (options.dependencySource !== 'local' || !options.repoRoot) {
    return {};
  }

  const repoRoot = resolve(options.repoRoot);
  const outputDirectory = createLocalPackageCachePath(repoRoot);
  const cacheStampPath = join(outputDirectory, LOCAL_PACKAGE_CACHE_STAMP_FILE);
  mkdirSync(outputDirectory, { recursive: true });

  const packageNames = LOCAL_PACKAGE_NAMES;
  const packageVersions = collectLocalPackageVersions(repoRoot, packageNames);
  const expectedCacheStamp = computeLocalPackageCacheStamp(repoRoot, packageNames, packageVersions);
  const currentCacheStamp = readLocalPackageCacheStamp(cacheStampPath);
  const canReuseCachedTarballs = expectedCacheStamp
    ? cacheStampMatches(expectedCacheStamp, currentCacheStamp)
      && cacheContainsTarballs(outputDirectory, packageNames, packageVersions)
    : false;

  if (!canReuseCachedTarballs) {
    await ensureWorkspaceBuildOutput(repoRoot, packageNames);
    await packLocalPackages(repoRoot, outputDirectory, packageNames, packageVersions);

    if (expectedCacheStamp) {
      writeFileSync(cacheStampPath, `${JSON.stringify(expectedCacheStamp, null, 2)}\n`, 'utf8');
    } else {
      rmSync(cacheStampPath, { force: true });
    }
  }

  return createLocalTarballSpecs(outputDirectory, packageNames, packageVersions);
}

export const scaffoldKonektiApp = scaffoldBootstrapApp;
