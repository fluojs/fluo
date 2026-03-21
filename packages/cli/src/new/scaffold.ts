import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { installDependencies } from './install.js';
import type { BootstrapOptions, PackageManager } from './types.js';

const PACKAGE_DIRECTORY_BY_NAME = {
  '@konekti/cli': 'cli',
  '@konekti/config': 'config',
  '@konekti/core': 'core',
  '@konekti/dto-validator': 'dto-validator',
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
  '@konekti/dto-validator',
  '@konekti/di',
  '@konekti/http',
  '@konekti/runtime',
  '@konekti/testing',
];

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
        build: "babel src --extensions .ts --ignore 'src/**/*.test.ts' --out-dir dist --config-file ./babel.config.cjs && tsc -p tsconfig.build.json",
        dev: 'node --env-file=.env.dev --watch --watch-preserve-output --import tsx src/main.ts',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      },
      dependencies: {
        '@konekti/config': createDependencySpec('@konekti/config', releaseVersion, packageSpecs),
        '@konekti/core': createDependencySpec('@konekti/core', releaseVersion, packageSpecs),
        '@konekti/dto-validator': createDependencySpec('@konekti/dto-validator', releaseVersion, packageSpecs),
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
`;
}

function createAppFile(): string {
  return `import { Global, Module } from '@konekti/core';
import { createHealthModule } from '@konekti/runtime';

import { HealthModule } from './health/health.module';

const RuntimeHealthModule = createHealthModule();

@Global()
@Module({
  imports: [
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
      service: '${projectName}',
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
  return `import { runNodeApplication } from '@konekti/runtime';

import { AppModule } from './app';

await runNodeApplication(AppModule, {
  mode: 'dev',
});
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
    const app = await KonektiFactory.create(AppModule, { mode: 'test' });
    const healthResponse = createResponse();
    const readyResponse = createResponse();

    await app.dispatch(createRequest('/health'), healthResponse);
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(healthResponse.body).toEqual({ status: 'ok' });
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('dispatches the health-info route', async () => {
    const app = await KonektiFactory.create(AppModule, { mode: 'test' });
    const response = createResponse();

    await app.dispatch(createRequest('/health-info/'), response);

    expect(response.body).toEqual({ ok: true, service: expect.any(String) });

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
    { content: createEnvFile(), path: '.env.dev' },
    { content: createEnvFile(), path: '.env.test' },
    { content: createEnvFile(), path: '.env.prod' },
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
  ];
}

export async function scaffoldBootstrapApp(
  options: BootstrapOptions,
  importMetaUrl = import.meta.url,
): Promise<void> {
  const targetDirectory = resolve(options.targetDirectory);
  const releaseVersion = readOwnPackageVersion(importMetaUrl);
  const packageSpecs = await resolvePackageSpecs(targetDirectory, options);

  mkdirSync(targetDirectory, { recursive: true });

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

    await runPackCommand(repoRoot, PACKAGE_DIRECTORY_BY_NAME[packageName], outputDirectory);
    await normalizePackedPackageManifest(outputDirectory, expectedTarballName(packageName, packageVersion), packageVersions);
  }
}

function createLocalTarballSpecs(
  targetDirectory: string,
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

    tarballs.set(packageName, `file:${relative(targetDirectory, join(outputDirectory, tarball))}`);
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

async function resolvePackageSpecs(targetDirectory: string, options: BootstrapOptions): Promise<Record<string, string>> {
  if (options.dependencySource !== 'local' || !options.repoRoot) {
    return {};
  }

  const repoRoot = resolve(options.repoRoot);
  const outputDirectory = join(targetDirectory, '.konekti', 'packages');
  mkdirSync(outputDirectory, { recursive: true });

  const packageNames = LOCAL_PACKAGE_NAMES;
  const packageVersions = collectLocalPackageVersions(repoRoot, packageNames);

  await ensureWorkspaceBuildOutput(repoRoot, packageNames);
  await packLocalPackages(repoRoot, outputDirectory, packageNames, packageVersions);

  return createLocalTarballSpecs(targetDirectory, outputDirectory, packageNames, packageVersions);
}

export const scaffoldKonektiApp = scaffoldBootstrapApp;
