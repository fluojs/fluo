import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldBootstrapApp } from './scaffold.js';
import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';

const temporaryDirectories: string[] = [];
const LOCAL_PACKAGE_DIRECTORY_BY_NAME = {
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

const FIXTURE_WORKSPACE_DEPENDENCIES: Partial<Record<keyof typeof LOCAL_PACKAGE_DIRECTORY_BY_NAME, Record<string, string>>> = {
  '@fluojs/http': {
    '@fluojs/core': 'workspace:*',
    '@fluojs/di': 'workspace:*',
    '@fluojs/validation': 'workspace:*',
  },
  '@fluojs/platform-fastify': {
    '@fluojs/http': 'workspace:*',
    '@fluojs/runtime': 'workspace:*',
  },
  '@fluojs/platform-express': {
    '@fluojs/http': 'workspace:*',
    '@fluojs/runtime': 'workspace:*',
  },
  '@fluojs/platform-nodejs': {
    '@fluojs/http': 'workspace:*',
    '@fluojs/runtime': 'workspace:*',
  },
  '@fluojs/runtime': {
    '@fluojs/config': 'workspace:*',
    '@fluojs/core': 'workspace:*',
  },
  '@fluojs/testing': {
    '@fluojs/runtime': 'workspace:*',
  },
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function readDirectorySnapshot(rootDirectory: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const pending = [rootDirectory];

  while (pending.length > 0) {
    const currentDirectory = pending.pop();

    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory)) {
      const entryPath = join(currentDirectory, entry);
      const entryStat = statSync(entryPath);

      if (entryStat.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      snapshot[relative(rootDirectory, entryPath)] = readFileSync(entryPath, 'utf8');
    }
  }

  return snapshot;
}

function createLocalPackageCacheDirectory(repoRoot: string): string {
  return join(tmpdir(), 'fluo-cli-local-packages', createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 12));
}

function createFixtureLocalRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'fluo-local-repo-'));
  temporaryDirectories.push(repoRoot);

  for (const [packageName, packageDirectory] of Object.entries(LOCAL_PACKAGE_DIRECTORY_BY_NAME)) {
    const packageRoot = join(repoRoot, 'packages', packageDirectory);
    const distDirectory = join(packageRoot, 'dist');
    mkdirSync(distDirectory, { recursive: true });
    writeFileSync(
      join(packageRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: packageName,
          version: '1.0.0',
          type: 'module',
          files: ['dist'],
          main: 'dist/index.js',
          types: 'dist/index.d.ts',
          dependencies: FIXTURE_WORKSPACE_DEPENDENCIES[packageName as keyof typeof LOCAL_PACKAGE_DIRECTORY_BY_NAME] ?? {},
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    writeFileSync(join(distDirectory, 'index.js'), `export const packageName = '${packageName}';\n`, 'utf8');
    writeFileSync(join(distDirectory, 'index.d.ts'), `export declare const packageName: '${packageName}';\n`, 'utf8');
  }

  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'fixture'],
    { cwd: repoRoot, stdio: 'ignore' },
  );

  return repoRoot;
}

function createDefaultLocalScaffoldOptions(targetDirectory: string, repoRoot: string) {
  return {
    ...DEFAULT_BOOTSTRAP_SCHEMA,
    dependencySource: 'local' as const,
    packageManager: 'pnpm' as const,
    projectName: 'starter-app',
    repoRoot,
    skipInstall: true,
    targetDirectory,
  };
}

function readLocalDependencyTarballPaths(targetDirectory: string): string[] {
  const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const fileSpecs = new Set<string>();

  for (const section of [packageJson.dependencies, packageJson.devDependencies]) {
    for (const specifier of Object.values(section ?? {})) {
      if (specifier.startsWith('file:')) {
        fileSpecs.add(specifier.slice('file:'.length));
      }
    }
  }

  return Array.from(fileSpecs);
}

function readPackedPackageManifest(tarballPath: string): {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      encoding: 'utf8',
    }),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

function expectNoWorkspaceProtocolDependencies(tarballPath: string): void {
  const manifest = readPackedPackageManifest(tarballPath);

  for (const section of [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
    for (const specifier of Object.values(section ?? {})) {
      expect(specifier).not.toContain('workspace:');
    }
  }
}

describe('scaffoldBootstrapApp', () => {
  it('generates TS6 starter configs without deprecated baseUrl aliases', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsconfig = readFileSync(join(targetDirectory, 'tsconfig.json'), 'utf8');
    const tsconfigBuild = readFileSync(join(targetDirectory, 'tsconfig.build.json'), 'utf8');
    const viteConfig = readFileSync(join(targetDirectory, 'vite.config.ts'), 'utf8');
    const vitestConfig = readFileSync(join(targetDirectory, 'vitest.config.ts'), 'utf8');

    expect(packageJson.devDependencies?.typescript).toBe('^6.0.2');
    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/http': expect.any(String),
      '@fluojs/platform-fastify': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(tsconfig).not.toContain('baseUrl');
    expect(tsconfigBuild).not.toContain('baseUrl');
    expect(viteConfig).toContain("import { defineConfig } from 'vite';");
    expect(viteConfig).not.toContain('baseUrl');
    expect(vitestConfig).toContain("import { fluoBabelDecoratorsPlugin } from '@fluojs/testing/vitest';");
    expect(vitestConfig).not.toContain('baseUrl');
  });

  it('packs local starter tarballs from staged package manifests without workspace protocol dependencies', async () => {
    const repoRoot = createFixtureLocalRepo();
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-local-pack-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp(createDefaultLocalScaffoldOptions(targetDirectory, repoRoot));

    const tarballPaths = readLocalDependencyTarballPaths(targetDirectory);

    expect(tarballPaths.length).toBeGreaterThan(0);

    for (const tarballPath of tarballPaths) {
      expectNoWorkspaceProtocolDependencies(tarballPath);
    }
  }, 30_000);

  it('invalidates stale local package cache tarballs from the old rewrite pipeline', async () => {
    const repoRoot = createFixtureLocalRepo();
    const localPackageCacheDirectory = createLocalPackageCacheDirectory(repoRoot);
    const warmupTargetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-local-cache-warmup-'));
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-local-cache-refresh-'));
    temporaryDirectories.push(warmupTargetDirectory, targetDirectory);

    await scaffoldBootstrapApp(createDefaultLocalScaffoldOptions(warmupTargetDirectory, repoRoot));

    const tarballPaths = readLocalDependencyTarballPaths(warmupTargetDirectory);
    expect(tarballPaths.length).toBeGreaterThan(0);

    const staleTarballPath = tarballPaths[0];
    const staleTarballName = staleTarballPath.split('/').at(-1);
    expect(staleTarballName).toBeTruthy();

    const cacheStampPath = join(localPackageCacheDirectory, 'cache-stamp.json');
    const cacheStamp = JSON.parse(readFileSync(cacheStampPath, 'utf8')) as {
      cacheFormatVersion?: number;
      dirtyFingerprint: string;
      headCommit: string;
      packageVersions: Record<string, string>;
    };

    writeFileSync(staleTarballPath, 'stale tarball from old rewrite pipeline', 'utf8');
    writeFileSync(
      cacheStampPath,
      `${JSON.stringify(
        {
          dirtyFingerprint: cacheStamp.dirtyFingerprint,
          headCommit: cacheStamp.headCommit,
          packageVersions: cacheStamp.packageVersions,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    await scaffoldBootstrapApp(createDefaultLocalScaffoldOptions(targetDirectory, repoRoot));

    const refreshedTarballPath = readLocalDependencyTarballPaths(targetDirectory).find((tarballPath) => tarballPath.endsWith(`/${staleTarballName}`));
    expect(refreshedTarballPath).toBeTruthy();
    expect(readFileSync(refreshedTarballPath!, 'utf8')).not.toContain('stale tarball from old rewrite pipeline');
    expectNoWorkspaceProtocolDependencies(refreshedTarballPath!);
  }, 30_000);

  it('keeps the default Node + Fastify HTTP scaffold identical when explicit shape flags are provided', async () => {
    const defaultTargetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-default-'));
    const explicitTargetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-explicit-'));
    temporaryDirectories.push(defaultTargetDirectory, explicitTargetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory: defaultTargetDirectory,
    });

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'fastify',
      projectName: 'starter-app',
      runtime: 'node',
      shape: 'application',
      skipInstall: true,
      targetDirectory: explicitTargetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    expect(readDirectorySnapshot(explicitTargetDirectory)).toEqual(readDirectorySnapshot(defaultTargetDirectory));
  });

  it('describes only the wired application starter path in generated HTTP starter output', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-http-wording-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(readme).toContain('Starter contract: `src/main.ts` wires the selected first-class application starter: Node.js runtime + Fastify HTTP via `createFastifyAdapter(...)`');
    expect(readme).toContain('Default baseline: when you omit `--platform`, `fluo new` still generates the Node.js + Fastify HTTP starter by default');
    expect(readme).toContain('Broader runtime/adapter package coverage is documented in the fluo docs and package READMEs; this generated starter intentionally describes only the wired starter path above');
    expect(readme).not.toContain('Bun');
    expect(readme).not.toContain('Deno');
    expect(readme).not.toContain('Cloudflare');
    expect(readme).not.toContain('@fluojs/platform-nodejs');
    expect(mainFile).toContain('// The generated starter wires the selected first-class fluo new application path:');
    expect(mainFile).toContain('// Node.js runtime + Fastify HTTP via createFastifyAdapter(...).');
    expect(mainFile).not.toContain('Bun');
    expect(mainFile).not.toContain('Deno');
    expect(mainFile).not.toContain('Cloudflare');
    expect(mainFile).not.toContain('@fluojs/platform-nodejs');
  });

  it('generates the Express application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-express-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'express',
      projectName: 'starter-express',
      runtime: 'node',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-express': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-fastify');
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-nodejs');
    expect(readme).toContain('Node.js runtime + Express HTTP via `createExpressAdapter(...)`');
    expect(mainFile).toContain("import { createExpressAdapter } from '@fluojs/platform-express';");
    expect(mainFile).toContain('adapter: createExpressAdapter({ port })');
  });

  it('generates the Bun application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-bun-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'bun',
      projectName: 'starter-bun',
      runtime: 'bun',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-bun': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.scripts?.dev).toBe('bun --watch src/main.ts');
    expect(readme).toContain('Bun runtime + Bun native HTTP via `createBunAdapter(...)`');
    expect(mainFile).toContain("import { createBunAdapter } from '@fluojs/platform-bun';");
    expect(mainFile).toContain("Bun.env.PORT ?? '3000'");
  });

  it('generates the raw Node.js application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-nodejs-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'nodejs',
      projectName: 'starter-nodejs',
      runtime: 'node',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-nodejs': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-fastify');
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-express');
    expect(readme).toContain('Node.js runtime + raw Node.js HTTP via `createNodejsAdapter(...)`');
    expect(mainFile).toContain("import { createNodejsAdapter } from '@fluojs/platform-nodejs';");
    expect(mainFile).toContain('adapter: createNodejsAdapter({ port })');
  });

  it('generates the Deno application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-deno-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'deno',
      projectName: 'starter-deno',
      runtime: 'deno',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');
    const appTestFile = readFileSync(join(targetDirectory, 'src', 'app.test.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-deno': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.scripts?.dev).toContain('deno run --allow-env --allow-net --watch src/main.ts');
    expect(packageJson.devDependencies).not.toHaveProperty('vitest');
    expect(readme).toContain('Deno runtime + Deno native HTTP via `runDenoApplication(...)`');
    expect(appFile).toContain("Deno.env.toObject()");
    expect(appFile).toContain("'./health/health.module.ts'");
    expect(mainFile).toContain("import { AppModule } from './app.ts';");
    expect(appTestFile).toContain('Deno.test');
  });

  it('generates the Cloudflare Workers application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-workers-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'cloudflare-workers',
      projectName: 'starter-workers',
      runtime: 'cloudflare-workers',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const workerFile = readFileSync(join(targetDirectory, 'src', 'worker.ts'), 'utf8');
    const wranglerConfig = readFileSync(join(targetDirectory, 'wrangler.jsonc'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-cloudflare-workers': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/config');
    expect(packageJson.devDependencies).toHaveProperty('wrangler');
    expect(packageJson.scripts?.dev).toBe('wrangler dev');
    expect(readDirectorySnapshot(targetDirectory)).not.toHaveProperty('.env');
    expect(readme).toContain('Cloudflare Workers runtime + Cloudflare Workers HTTP via `createCloudflareWorkerEntrypoint(...)`');
    expect(appFile).not.toContain('ConfigModule.forRoot');
    expect(workerFile).toContain('createCloudflareWorkerEntrypoint(AppModule)');
    expect(wranglerConfig).toContain('src/worker.ts');
  });

  it('generates a runnable TCP microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');
    const appTestFile = readFileSync(join(targetDirectory, 'src', 'app.test.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/config': expect.any(String),
      '@fluojs/microservices': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/http');
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-fastify');
    expect(readme).toContain('Shape: `microservice`');
    expect(readme).toContain('Transport: `tcp` is the generated runnable starter contract for this project');
    expect(envFile).toContain('MICROSERVICE_PORT=4000');
    expect(appFile).toContain('new TcpMicroserviceTransport({ host, port })');
    expect(mainFile).toContain('FluoFactory.createMicroservice(AppModule)');
    expect(appTestFile).toContain('InMemoryLoopbackTransport');
  });

  it('generates a runnable Redis Streams microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-redis-streams-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice-redis-streams',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'redis-streams',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/microservices': expect.any(String),
      ioredis: '^5.0.0',
    });
    expect(readme).toContain('Transport: `redis-streams` is the generated runnable starter contract for this project');
    expect(readme).toContain('REDIS_URL');
    expect(envFile).toContain('REDIS_URL=redis://127.0.0.1:6379');
    expect(envFile).toContain('REDIS_STREAMS_NAMESPACE=fluo:streams');
    expect(appFile).toContain("import Redis from 'ioredis';");
    expect(appFile).toContain('new RedisStreamsMicroserviceTransport({');
    expect(appFile).toContain('readerClient');
  });

  it('generates a runnable MQTT microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-mqtt-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice-mqtt',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'mqtt',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/microservices': expect.any(String),
      mqtt: '^5.0.0',
    });
    expect(readme).toContain('Transport: `mqtt` is the generated runnable starter contract for this project');
    expect(envFile).toContain('MQTT_URL=mqtt://127.0.0.1:1883');
    expect(envFile).toContain('MQTT_NAMESPACE=fluo.microservices');
    expect(appFile).toContain('new MqttMicroserviceTransport({');
    expect(appFile).toContain('requestTimeoutMs: 3_000');
  });

  it('generates a runnable gRPC microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-grpc-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice-grpc',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'grpc',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const mathHandlerFile = readFileSync(join(targetDirectory, 'src', 'math', 'math.handler.ts'), 'utf8');
    const protoFile = readFileSync(join(targetDirectory, 'proto', 'math.proto'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/microservices': expect.any(String),
      '@grpc/grpc-js': '^1.0.0',
      '@grpc/proto-loader': '^0.8.0',
    });
    expect(readme).toContain('Transport: `grpc` is the generated runnable starter contract for this project');
    expect(readme).toContain('proto/math.proto');
    expect(envFile).toContain('GRPC_URL=127.0.0.1:50051');
    expect(appFile).toContain('new GrpcMicroserviceTransport({');
    expect(appFile).toContain("packageName: 'fluo.microservices'");
    expect(mathHandlerFile).toContain('MathService.Sum');
    expect(protoFile).toContain('service MathService');
    expect(protoFile).toContain('rpc Sum (SumRequest) returns (SumResponse);');
  });

  it('generates a runnable NATS microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-nats-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice-nats',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'nats',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/microservices': expect.any(String),
      nats: '^2.29.3',
    });
    expect(readme).toContain('Transport: `nats` is the generated runnable starter contract for this project');
    expect(readme).toContain('caller-owned `nats` client plus `JSONCodec()`');
    expect(envFile).toContain('NATS_SERVERS=nats://127.0.0.1:4222');
    expect(envFile).toContain('NATS_MESSAGE_SUBJECT=fluo.microservices.messages');
    expect(appFile).toContain("import { JSONCodec, connect } from 'nats';");
    expect(appFile).toContain('new NatsMicroserviceTransport({');
    expect(appFile).toContain("name: 'fluo-microservice-starter'");
  });

  it('generates a runnable Kafka microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-kafka-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice-kafka',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'kafka',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/microservices': expect.any(String),
      kafkajs: '^2.2.4',
    });
    expect(readme).toContain('Transport: `kafka` is the generated runnable starter contract for this project');
    expect(readme).toContain('producer/consumer collaborators');
    expect(envFile).toContain('KAFKA_BROKERS=127.0.0.1:9092');
    expect(envFile).toContain('KAFKA_RESPONSE_TOPIC=fluo.microservices.responses');
    expect(appFile).toContain("import { Kafka, logLevel } from 'kafkajs';");
    expect(appFile).toContain('new KafkaMicroserviceTransport({');
    expect(appFile).toContain('await Promise.all([producer.connect(), consumer.connect()]);');
  });

  it('generates a runnable RabbitMQ microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-rabbitmq-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice-rabbitmq',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'rabbitmq',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/microservices': expect.any(String),
      amqplib: '^0.10.5',
    });
    expect(packageJson.devDependencies).toMatchObject({
      '@types/amqplib': '^0.10.7',
    });
    expect(readme).toContain('Transport: `rabbitmq` is the generated runnable starter contract for this project');
    expect(readme).toContain('publisher/consumer collaborators');
    expect(envFile).toContain('RABBITMQ_URL=amqp://127.0.0.1:5672');
    expect(envFile).toContain('RABBITMQ_RESPONSE_QUEUE=fluo.microservices.responses');
    expect(appFile).toContain("import { connect } from 'amqplib';");
    expect(appFile).toContain('new RabbitMqMicroserviceTransport({');
    expect(appFile).toContain('createConfirmChannel()');
  });

  it('generates a mixed single-package scaffold with an attached TCP microservice', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-mixed-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'fastify',
      projectName: 'starter-mixed',
      runtime: 'node',
      shape: 'mixed',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');
    const appTestFile = readFileSync(join(targetDirectory, 'src', 'app.test.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/http': expect.any(String),
      '@fluojs/microservices': expect.any(String),
      '@fluojs/platform-fastify': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.scripts).not.toHaveProperty('dev:microservice');
    expect(readme).toContain('Shape: `mixed`');
    expect(readme).toContain('attached TCP microservice');
    expect(envFile).toContain('PORT=3000');
    expect(envFile).toContain('MICROSERVICE_PORT=4000');
    expect(appFile).toContain('MicroservicesModule.forRoot');
    expect(mainFile).toContain('await app.connectMicroservice();');
    expect(mainFile).toContain('await app.startAllMicroservices();');
    expect(appTestFile).toContain('InMemoryLoopbackTransport');
    expect(readDirectorySnapshot(targetDirectory)).not.toHaveProperty('src/microservice.ts');
  });

  it('can initialize git while skipping dependency installation', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-git-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      initializeGit: true,
      installDependencies: false,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      targetDirectory,
    });

    expect(statSync(join(targetDirectory, '.git')).isDirectory()).toBe(true);
    expect(readFileSync(join(targetDirectory, 'package.json'), 'utf8')).toContain('"name": "starter-app"');
  });
});
