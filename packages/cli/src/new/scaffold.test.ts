import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldBootstrapApp } from './scaffold.js';
import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';

const temporaryDirectories: string[] = [];

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
    expect(envFile).toContain('MICROSERVICE_PORT=4000');
    expect(appFile).toContain('new TcpMicroserviceTransport({ host, port })');
    expect(mainFile).toContain('FluoFactory.createMicroservice(AppModule)');
    expect(appTestFile).toContain('InMemoryLoopbackTransport');
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
